import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { notifyChitPaymentReceived } from '@/lib/services/chitNotifications.js';
import { logError } from '@/lib/logger.js';

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

    let query = db('ticket_payments')
      .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
      .where('ticket_payments.ticket_id', id)
      .select('ticket_payments.*', 'ticket_members.name as member_name', 'ticket_members.phone as member_phone');

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

export async function PUT(request, { params }) {
  try {
    const user = await requireAuth(request); // Admin or agent can mark payments
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const { payment_id, is_paid } = await request.json();

    if (!payment_id) {
      return NextResponse.json({ message: 'payment_id is required.' }, { status: 400 });
    }

    const existing = await db('ticket_payments').where({ id: payment_id, ticket_id: id }).first();
    if (!existing) {
      return NextResponse.json({ message: 'Payment record not found.' }, { status: 404 });
    }
    const justPaid = !!is_paid && !existing.is_paid;

    const updated = await db('ticket_payments')
      .where({ id: payment_id, ticket_id: id })
      .update({
        is_paid: !!is_paid,
        payment_date: is_paid ? db.fn.now() : null
      });

    if (!updated) {
      return NextResponse.json({ message: 'Payment record not found.' }, { status: 404 });
    }

    // Get the updated payment details for audit log
    const payment = await db('ticket_payments')
      .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
      .where('ticket_payments.id', payment_id)
      .select('ticket_payments.*', 'ticket_members.name as member_name')
      .first();

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_PAYMENT_TOGGLE',
      description: `Marked payment for ${payment.member_name} (Round ${payment.round_number}) as ${is_paid ? 'Paid' : 'Unpaid'}.`
    });

    // Thank-you SMS only on the moment a payment goes from unpaid to paid —
    // ticking it again, or un-ticking it, never sends anything.
    let sms = 'none';
    if (justPaid) {
      const member = await db('ticket_members').where({ id: payment.member_id }).first();
      if (member?.phone) {
        // Awaited on purpose: on Vercel a function can be frozen the moment it
        // replies, which would cut off an un-awaited SMS request. A failure
        // here must never fail the payment itself, so it is caught and logged.
        try {
          const result = await notifyChitPaymentReceived(payment_id);
          sms = result?.mocked ? 'mocked' : result?.failed ? 'failed' : result?.sent ? 'sent' : 'none';
        } catch (err) {
          sms = 'failed';
          logError('Chit payment SMS failed', err, { paymentId: payment_id });
        }
      } else {
        sms = 'no_phone';
      }
    }

    return NextResponse.json({ message: 'Payment updated successfully.', payment, sms });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update payment error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update payment.' }, { status: 500 });
  }
}
