import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { notifyChitPaymentReceived } from '@/lib/services/chitNotifications.js';
import { postChitCollection } from '@/lib/services/chitLedger.js';
import { logError } from '@/lib/logger.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The thank-you SMS goes out only when a payment moves to paid. Awaited on
// purpose: on Vercel a function can be frozen the moment it replies, which
// would cut off an un-awaited SMS request. A failure must never fail the
// payment itself, so it is caught and logged.
async function sendThankYouSms(paymentId, memberId) {
  const member = await db('ticket_members').where({ id: memberId }).first();
  if (!member?.phone) return 'no_phone';
  try {
    const result = await notifyChitPaymentReceived(paymentId);
    return result?.mocked ? 'mocked' : result?.failed ? 'failed' : result?.sent ? 'sent' : 'none';
  } catch (err) {
    logError('Chit payment SMS failed', err, { paymentId });
    return 'failed';
  }
}

function paymentWithNames() {
  return db('ticket_payments')
    .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
    .leftJoin('ticket_auctions', 'ticket_payments.auction_id', 'ticket_auctions.id')
    .leftJoin('users as collectors', 'ticket_payments.collected_by', 'collectors.id')
    .select(
      'ticket_payments.*',
      'ticket_members.name as member_name',
      'ticket_members.phone as member_phone',
      'ticket_auctions.amount_per_member as amount_due',
      'collectors.name as collected_by_name'
    );
}

export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const url = new URL(request.url);
    const roundStr = url.searchParams.get('round');
    const auctionId = url.searchParams.get('auction_id');

    if (!roundStr && !auctionId) {
      return NextResponse.json({ message: 'Missing round number or auction_id filter.' }, { status: 400 });
    }

    let query = paymentWithNames().where('ticket_payments.ticket_id', id);

    if (auctionId) {
      query = query.where('ticket_payments.auction_id', auctionId);
    } else {
      query = query.where('ticket_payments.round_number', parseInt(roundStr, 10));
    }

    const payments = await query.orderBy('member_name', 'asc');
    return NextResponse.json(payments);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('List ticket payments error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to fetch payments.' }, { status: 500 });
  }
}

// Tick or un-tick a payment that already has a row (created when the round's
// auction was run, or by an earlier pre-auction collection).
export async function PUT(request, { params }) {
  try {
    // Admins only: ticking a payment records collected money and sends the member an SMS.
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const { payment_id, is_paid, amount } = await request.json();

    if (!payment_id) {
      return NextResponse.json({ message: 'payment_id is required.' }, { status: 400 });
    }

    const existing = await paymentWithNames().where({ 'ticket_payments.id': payment_id, 'ticket_payments.ticket_id': id }).first();
    if (!existing) {
      return NextResponse.json({ message: 'Payment record not found.' }, { status: 404 });
    }

    // What is recorded as collected: an amount typed by the admin, else the
    // round's per-member figure once the auction has run.
    let collectedAmount = null;
    if (is_paid) {
      collectedAmount = amount !== undefined && amount !== null && amount !== '' ? parseFloat(amount) : parseFloat(existing.amount_due);
      if (!(collectedAmount > 0)) {
        return NextResponse.json({ message: 'Enter the amount collected.' }, { status: 400 });
      }
    }

    // Atomic change: the row is only updated if it is NOT already in the requested
    // state. If two requests arrive at the same instant (double-tap, slow connection)
    // exactly one of them changes the row, so exactly one SMS, ledger posting and
    // audit entry.
    const changed = await db.transaction(async (trx) => {
      const updated = await trx('ticket_payments')
        .where({ id: payment_id, ticket_id: id })
        .andWhere('is_paid', !is_paid)
        .update({
          is_paid: !!is_paid,
          payment_date: is_paid ? db.fn.now() : null,
          amount: is_paid ? collectedAmount : null,
          collected_by: is_paid ? user.id : null
        });
      if (!updated) return false;

      if (is_paid) await postChitCollection(trx, collectedAmount);
      else await postChitCollection(trx, existing.amount ?? existing.amount_due, { reverse: true });

      await trx('audit_logs').insert({
        actor_id: user.id,
        action_type: 'TICKET_PAYMENT_TOGGLE',
        description: is_paid
          ? `Collected LKR ${money(collectedAmount)} from ${existing.member_name} (Round ${existing.round_number}).`
          : `Marked payment for ${existing.member_name} (Round ${existing.round_number}) as Unpaid (LKR ${money(existing.amount ?? existing.amount_due)} reversed).`
      });
      return true;
    });

    const payment = await paymentWithNames().where('ticket_payments.id', payment_id).first();

    if (!changed) {
      return NextResponse.json({ message: 'Payment was already in that state.', payment, sms: 'none', unchanged: true });
    }

    // Thank-you SMS only on the moment a payment goes from unpaid to paid —
    // ticking it again, or un-ticking it, never sends anything.
    const sms = is_paid ? await sendThankYouSms(payment_id, existing.member_id) : 'none';

    return NextResponse.json({ message: 'Payment updated successfully.', payment, sms });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update payment error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update payment.' }, { status: 500 });
  }
}

// Collect a member's payment for the round that has not had its auction run
// yet. The amount is not known from an auction at that point, so the admin
// enters it. When the auction is run later, these payments are linked to it.
export async function POST(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const { member_id, amount } = await request.json();

    const collectedAmount = parseFloat(amount);
    if (!member_id) {
      return NextResponse.json({ message: 'member_id is required.' }, { status: 400 });
    }
    if (!(collectedAmount > 0)) {
      return NextResponse.json({ message: 'Enter the amount collected.' }, { status: 400 });
    }

    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }
    if (ticket.status === 'completed') {
      return NextResponse.json({ message: 'This ticket group has already completed all rounds.' }, { status: 400 });
    }
    const member = await db('ticket_members').where({ id: member_id, ticket_id: id }).first();
    if (!member) {
      return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    }

    const round = ticket.current_round;
    const paymentId = await db.transaction(async (trx) => {
      const row = await trx('ticket_payments').where({ ticket_id: id, member_id, round_number: round }).first();
      if (row?.is_paid) return null;

      let rowId = row?.id;
      const fields = { is_paid: true, payment_date: db.fn.now(), amount: collectedAmount, collected_by: user.id };
      if (row) {
        await trx('ticket_payments').where({ id: row.id }).update(fields);
      } else {
        const [inserted] = await trx('ticket_payments')
          .insert({ ticket_id: id, member_id, round_number: round, auction_id: null, ...fields })
          .returning('id');
        rowId = inserted.id || inserted;
      }

      await postChitCollection(trx, collectedAmount);
      await trx('audit_logs').insert({
        actor_id: user.id,
        action_type: 'TICKET_PAYMENT_TOGGLE',
        description: `Collected LKR ${money(collectedAmount)} from ${member.name} (Round ${round}, before the auction was run).`
      });
      return rowId;
    });

    if (!paymentId) {
      return NextResponse.json({ message: `${member.name} is already marked as paid for Round ${round}.` }, { status: 409 });
    }

    const payment = await paymentWithNames().where('ticket_payments.id', paymentId).first();
    const sms = await sendThankYouSms(paymentId, member_id);
    return NextResponse.json({ message: 'Payment collected.', payment, sms }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Collect ticket payment error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to record the payment.' }, { status: 500 });
  }
}
