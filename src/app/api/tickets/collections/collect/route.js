import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { postChitCollection } from '@/lib/services/chitLedger.js';
import { notifyChitPaymentReceived, notifyChitCombinedPaymentReceived } from '@/lib/services/chitNotifications.js';
import { logError } from '@/lib/logger.js';

class CollectError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Collect several of one customer's chit payments in a single step (the
// "combo" line). Every payment is collected in full at its own amount due.
// All of them are saved together or none are: if any one was already
// collected, nothing changes and the screen is told to refresh.
export async function POST(request) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { payment_ids } = await request.json();
    if (!Array.isArray(payment_ids) || payment_ids.length === 0 || payment_ids.length > 20) {
      return NextResponse.json({ message: 'Choose at least one payment to collect.' }, { status: 400 });
    }
    const ids = [...new Set(payment_ids)];

    const collected = await db.transaction(async (trx) => {
      const rows = await trx('ticket_payments')
        .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
        .join('ticket_auctions', 'ticket_payments.auction_id', 'ticket_auctions.id')
        .whereIn('ticket_payments.id', ids)
        .select('ticket_payments.id', 'ticket_payments.round_number', 'ticket_payments.member_id', 'ticket_members.name as member_name',
          'ticket_auctions.amount_per_member as amount_due');
      if (rows.length !== ids.length) throw new CollectError('One of those payments was not found. Refresh and try again.', 404);

      const done = [];
      for (const row of rows) {
        const amount = parseFloat(row.amount_due);
        const updated = await trx('ticket_payments')
          .where({ id: row.id, is_paid: false })
          .update({ is_paid: true, payment_date: db.fn.now(), amount, collected_by: user.id });
        if (!updated) throw new CollectError(`${row.member_name}'s Round ${row.round_number} payment was already collected. Refresh the list.`, 409);
        await postChitCollection(trx, amount);
        await trx('audit_logs').insert({
          actor_id: user.id,
          action_type: 'TICKET_PAYMENT_TOGGLE',
          description: `Collected LKR ${money(amount)} from ${row.member_name} (Round ${row.round_number}) in a combined collection.`
        });
        done.push({ id: row.id, member_id: row.member_id, member_name: row.member_name, amount });
      }
      return done;
    });

    // One SMS for the whole visit, not one per chit. Awaited: on Vercel a
    // function can be frozen the moment it replies. A failure never undoes the collection.
    let sms = 'none';
    try {
      const ids = collected.map((c) => c.id);
      const result = ids.length === 1 ? await notifyChitPaymentReceived(ids[0]) : await notifyChitCombinedPaymentReceived(ids);
      sms = result?.reason === 'no_phone' ? 'no_phone' : result?.mocked ? 'mocked' : result?.failed ? 'failed' : result?.sent ? 'sent' : 'none';
    } catch (err) {
      sms = 'failed';
      logError('Combined chit payment SMS failed', err, { count: collected.length });
    }

    return NextResponse.json({ message: 'Payments collected.', collected, total: collected.reduce((s, c) => s + c.amount, 0), sms });
  } catch (error) {
    if (error instanceof AuthError || error instanceof CollectError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Combined chit collection error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to record the payments.' }, { status: 500 });
  }
}
