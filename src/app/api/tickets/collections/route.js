import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { normalizePhone } from '@/lib/phone.js';
import { logError } from '@/lib/logger.js';

// Everything to collect right now, one line per customer. A customer who is in
// more than one chit group (matched by phone number) appears once, with each
// chit's amount listed separately and a combined total.
//
// "Right now" for a group is the round whose auction was run most recently
// (current_round - 1, or the last round once the group has completed): that is
// the round whose payments are being collected.
export async function GET(request) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const tickets = await db('tickets').select('id', 'name', 'status', 'current_round', 'member_count');
    const targets = tickets
      .map((t) => ({ ticket: t, round: t.status === 'completed' ? t.member_count : t.current_round - 1 }))
      .filter((x) => x.round >= 1);

    const perGroup = await Promise.all(targets.map(({ ticket, round }) =>
      db('ticket_payments')
        .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
        .join('ticket_auctions', 'ticket_payments.auction_id', 'ticket_auctions.id')
        .leftJoin('users as collectors', 'ticket_payments.collected_by', 'collectors.id')
        .where({ 'ticket_payments.ticket_id': ticket.id, 'ticket_payments.round_number': round })
        .select(
          'ticket_payments.id as payment_id', 'ticket_payments.member_id', 'ticket_payments.is_paid', 'ticket_payments.amount',
          'ticket_payments.payment_date', 'ticket_members.name as member_name', 'ticket_members.phone as member_phone',
          'ticket_auctions.amount_per_member as amount_due', 'collectors.name as collected_by_name'
        )
        .then((rows) => rows.map((r) => ({ ...r, ticket_id: ticket.id, group_name: ticket.name, round_number: round })))
    ));

    const customers = new Map();
    for (const row of perGroup.flat()) {
      const phoneKey = normalizePhone(row.member_phone);
      // No usable phone number: cannot tell who it is, so it stays on its own line.
      const key = phoneKey.length >= 9 ? phoneKey : `member:${row.member_id}`;
      if (!customers.has(key)) customers.set(key, { key, name: row.member_name, phone: row.member_phone, chits: [] });
      customers.get(key).chits.push({
        payment_id: row.payment_id,
        ticket_id: row.ticket_id,
        group_name: row.group_name,
        round_number: row.round_number,
        amount_due: parseFloat(row.amount_due),
        is_paid: row.is_paid,
        amount_paid: row.is_paid ? parseFloat(row.amount) || 0 : null,
        payment_date: row.payment_date,
        collected_by_name: row.collected_by_name
      });
    }

    const list = [...customers.values()].map((c) => {
      const pending = c.chits.filter((x) => !x.is_paid);
      return {
        ...c,
        chits: c.chits.sort((a, b) => a.group_name.localeCompare(b.group_name)),
        total_due: c.chits.reduce((s, x) => s + x.amount_due, 0),
        total_pending: pending.reduce((s, x) => s + x.amount_due, 0),
        pending_count: pending.length
      };
    }).sort((a, b) => (b.pending_count > 0) - (a.pending_count > 0) || a.name.localeCompare(b.name));

    return NextResponse.json({
      customers: list,
      totals: {
        pending: list.reduce((s, c) => s + c.total_pending, 0),
        pending_customers: list.filter((c) => c.pending_count > 0).length
      }
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Chit collection list error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to load the chit collections.' }, { status: 500 });
  }
}
