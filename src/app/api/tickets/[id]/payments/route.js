import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { notifyChitPaymentReceived } from '@/lib/services/chitNotifications.js';
import { addInstalment, balanceDue, lockPayment, reversePayment, round2 } from '@/lib/services/chitPayments.js';
import { logError } from '@/lib/logger.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The thank-you SMS goes out each time money is collected: it says how much
// was received and, for a partial payment, what is still to pay. Awaited on
// purpose: on Vercel a function can be frozen the moment it replies, which
// would cut off an un-awaited SMS request. A failure must never fail the
// payment itself, so it is caught and logged.
async function sendThankYouSms(paymentId, memberId, instalment) {
  const member = await db('ticket_members').where({ id: memberId }).first();
  if (!member?.phone) return 'no_phone';
  try {
    const result = await notifyChitPaymentReceived(paymentId, instalment ? { received: instalment.amount, balance: instalment.balance } : undefined);
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
//   is_paid: true  - collect the rest of what is owed (or `amount`, if given)
//   is_paid: false - take back everything collected on this payment
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

    // The row is locked while it changes, so two requests arriving at the same
    // instant (double-tap, slow connection) are handled one after the other and
    // the second sees the result of the first: one SMS, ledger posting and
    // audit entry per real change.
    const result = await db.transaction(async (trx) => {
      const payment = await lockPayment(trx, payment_id, id);
      if (!payment) return { unchanged: true }; // removed since it was looked up
      const collectedSoFar = round2(payment.amount);

      if (!is_paid) {
        if (!(collectedSoFar > 0)) return { unchanged: true };
        const reversed = await reversePayment(trx, payment);
        await trx('audit_logs').insert({
          actor_id: user.id,
          action_type: 'TICKET_PAYMENT_TOGGLE',
          description: `Marked payment for ${existing.member_name} (Round ${existing.round_number}) as Unpaid (LKR ${money(reversed)} reversed).`
        });
        return { changed: true };
      }

      const typed = amount !== undefined && amount !== null && amount !== '';
      const wanted = typed ? amount : balanceDue(payment.amount_due, collectedSoFar);
      if (!typed && wanted === null) {
        return { error: 'Enter the amount collected.' };
      }
      if (!typed && wanted <= 0) return { unchanged: true };

      const added = await addInstalment(trx, payment, wanted, user.id);
      if (added.error) return { error: added.error };
      await trx('audit_logs').insert({
        actor_id: user.id,
        action_type: 'TICKET_PAYMENT_TOGGLE',
        description: `Collected LKR ${money(added.amount)} from ${existing.member_name} (Round ${existing.round_number}).${added.balance ? ` LKR ${money(added.balance)} still to pay.` : ''}`
      });
      return { changed: true, added };
    });

    if (result.error) {
      return NextResponse.json({ message: result.error }, { status: 400 });
    }

    const payment = await paymentWithNames().where('ticket_payments.id', payment_id).first();

    if (result.unchanged) {
      return NextResponse.json({ message: 'Payment was already in that state.', payment, sms: 'none', unchanged: true });
    }

    // Thank-you SMS each time money is collected — un-ticking never sends anything.
    const sms = result.added ? await sendThankYouSms(payment_id, existing.member_id, result.added) : 'none';

    return NextResponse.json({ message: 'Payment updated successfully.', payment, sms });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update payment error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update payment.' }, { status: 500 });
  }
}

// Collect an amount from a member. The amount can be less than what is owed:
// the rest stays as a balance and can be collected later.
//   { payment_id, amount } - a payment that already exists (the round's auction has run)
//   { member_id, amount }  - the current round, before its auction is run. The
//     amount due is not known yet, so the admin enters it; running the auction
//     later links these payments and works out whether they cover it.
export async function POST(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const { member_id, payment_id, amount } = await request.json();

    if (!member_id && !payment_id) {
      return NextResponse.json({ message: 'member_id or payment_id is required.' }, { status: 400 });
    }
    if (!(round2(amount) > 0)) {
      return NextResponse.json({ message: 'Enter the amount collected.' }, { status: 400 });
    }

    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }

    let memberId = member_id;
    if (payment_id) {
      const existing = await db('ticket_payments').where({ id: payment_id, ticket_id: id }).first();
      if (!existing) {
        return NextResponse.json({ message: 'Payment record not found.' }, { status: 404 });
      }
      memberId = existing.member_id;
    } else if (ticket.status === 'completed') {
      return NextResponse.json({ message: 'This ticket group has already completed all rounds.' }, { status: 400 });
    }
    const member = await db('ticket_members').where({ id: memberId, ticket_id: id }).first();
    if (!member) {
      return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    }

    const out = await db.transaction(async (trx) => {
      let rowId = payment_id;
      if (!rowId) {
        const row = await trx('ticket_payments').where({ ticket_id: id, member_id: memberId, round_number: ticket.current_round }).first();
        if (row) {
          rowId = row.id;
        } else {
          const [inserted] = await trx('ticket_payments')
            .insert({ ticket_id: id, member_id: memberId, round_number: ticket.current_round, auction_id: null, is_paid: false })
            .returning('id');
          rowId = inserted.id || inserted;
        }
      }

      const payment = await lockPayment(trx, rowId, id);
      const added = await addInstalment(trx, payment, amount, user.id);
      if (added.error) return { error: added.error };

      await trx('audit_logs').insert({
        actor_id: user.id,
        action_type: 'TICKET_PAYMENT_TOGGLE',
        description: `Collected LKR ${money(added.amount)} from ${member.name} (Round ${payment.round_number}${payment.auction_id ? '' : ', before the auction was run'}).${added.balance ? ` LKR ${money(added.balance)} still to pay.` : ''}`
      });
      return { rowId, added };
    });

    if (out.error) {
      return NextResponse.json({ message: out.error }, { status: 400 });
    }

    const payment = await paymentWithNames().where('ticket_payments.id', out.rowId).first();
    const sms = await sendThankYouSms(out.rowId, memberId, out.added);
    return NextResponse.json({ message: 'Payment collected.', payment, sms, collected: out.added.amount, balance: out.added.balance }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Collect ticket payment error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to record the payment.' }, { status: 500 });
  }
}
