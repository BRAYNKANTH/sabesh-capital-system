import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { settleRoundPayments } from '@/lib/services/chitPayments.js';
import { resolveWinner } from '@/lib/services/chitWinner.js';
import { logError } from '@/lib/logger.js';

export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const auctions = await db('ticket_auctions')
      .leftJoin('ticket_members', 'ticket_auctions.winner_member_id', 'ticket_members.id')
      .where('ticket_auctions.ticket_id', id)
      .select(
        'ticket_auctions.*', 'ticket_members.name as winner_name', 'ticket_members.phone as winner_phone',
        // what has actually been collected for the round so far, so the host can see
        // whether the pot is in hand before paying the winner
        db.raw('(SELECT COALESCE(SUM(p.amount), 0) FROM ticket_payments p WHERE p.auction_id = ticket_auctions.id) AS collected_total')
      )
      .orderBy('round_number', 'asc');

    return NextResponse.json(auctions);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('List ticket auctions error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to fetch auctions.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const { bid_amount, winner_member_id, auction_date, next_round_date } = await request.json();

    if (bid_amount === undefined || !auction_date) {
      return NextResponse.json({ message: 'Missing required fields.' }, { status: 400 });
    }

    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }

    if (ticket.status === 'completed') {
      return NextResponse.json({ message: 'This ticket group has already completed all rounds.' }, { status: 400 });
    }

    // Who wins: someone on this roster who has not won before; on the final round
    // the one member left is the winner by default.
    const roster = await db('ticket_members').where({ ticket_id: id }).select('id', 'name');
    const earlierWins = await db('ticket_auctions').where({ ticket_id: id }).whereNotNull('winner_member_id').select('winner_member_id', 'round_number');
    const resolved = resolveWinner({
      requestedId: winner_member_id,
      members: roster,
      wonByMember: new Map(earlierWins.map((r) => [r.winner_member_id, r.round_number])),
      isFinalRound: ticket.current_round >= parseInt(ticket.member_count, 10),
      memberCount: parseInt(ticket.member_count, 10)
    });
    if (resolved.error) {
      return NextResponse.json({ message: resolved.error }, { status: 400 });
    }
    const winnerId = resolved.winnerId;
    const winner = winnerId ? roster.find((m) => m.id === winnerId) : null;

    const bidVal = parseFloat(bid_amount);
    const totalVal = parseFloat(ticket.total_value);
    const memberCount = parseInt(ticket.member_count, 10);

    if (isNaN(bidVal) || bidVal < 0) {
      return NextResponse.json({ message: 'Bid amount must be zero or more.' }, { status: 400 });
    }
    if (bidVal > totalVal) {
      return NextResponse.json({ message: `Bid amount (LKR ${bidVal.toLocaleString()}) cannot be more than the group's total value (LKR ${totalVal.toLocaleString()}).` }, { status: 400 });
    }

    // Financial Calculations
    const winner_payout = totalVal - bidVal;
    const base_payment = winner_payout / memberCount;

    // Host fee calculations
    let host_fee_per_member = 0;
    const original_share = totalVal / memberCount;
    if (ticket.host_fee_type === 'percentage') {
      host_fee_per_member = original_share * (parseFloat(ticket.host_fee_value) / 100);
    } else {
      // fixed fee
      host_fee_per_member = parseFloat(ticket.host_fee_value);
    }

    const amount_per_member = base_payment + host_fee_per_member;

    // Transaction block
    let newAuction = null;
    await db.transaction(async (trx) => {
      // 1. Insert auction row
      const [inserted] = await trx('ticket_auctions').insert({
        ticket_id: id,
        round_number: ticket.current_round,
        auction_date,
        bid_amount: bidVal,
        winner_member_id: winnerId,
        winner_payout,
        base_payment,
        host_fee_per_member,
        amount_per_member
      }).returning('*');
      newAuction = inserted;

      // 2. Fetch all members in this group
      const members = await trx('ticket_members').where({ ticket_id: id });
      
      // 3. Link any payments already collected for this round before the
      //    auction was run, then create entries for the members who have none yet.
      await trx('ticket_payments')
        .where({ ticket_id: id, round_number: ticket.current_round })
        .whereNull('auction_id')
        .update({ auction_id: inserted.id });
      // The amount due is now known: money collected earlier either covers it
      // (the payment becomes paid) or leaves a balance.
      await settleRoundPayments(trx, id, ticket.current_round);
      const linked = await trx('ticket_payments').where({ ticket_id: id, round_number: ticket.current_round }).select('member_id');
      const linkedIds = new Set(linked.map(r => r.member_id));
      const missing = members.filter(m => !linkedIds.has(m.id));
      if (missing.length > 0) {
        const paymentRows = missing.map(m => ({
          auction_id: inserted.id,
          ticket_id: id,
          member_id: m.id,
          round_number: ticket.current_round,
          is_paid: false
        }));
        await trx('ticket_payments').insert(paymentRows);
      }

      // 4. Update ticket status / current_round
      const isLastRound = ticket.current_round >= memberCount;
      const nextRound = isLastRound ? ticket.current_round : ticket.current_round + 1;
      const newStatus = isLastRound ? 'completed' : 'active';

      await trx('tickets').where({ id }).update({
        current_round: nextRound,
        next_round_date: next_round_date || null,
        status: newStatus
      });
    });

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_AUCTION_RUN',
      description: `Ran round ${ticket.current_round} for ticket '${ticket.name}'. Winner: ${winner ? winner.name : 'None'}${resolved.auto ? ' (the last remaining member)' : ''} (Payout: ${winner_payout} LKR).`
    });

    return NextResponse.json({ ...newAuction, winner_name: winner ? winner.name : null }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Run auction error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to run auction round.' }, { status: 500 });
  }
}
