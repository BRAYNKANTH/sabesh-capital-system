import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { postChitPayout } from '@/lib/services/chitLedger.js';
import { round2 } from '@/lib/services/chitPayments.js';
import { logError } from '@/lib/logger.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Postgres "undefined column": the payouts migration has not been run yet.
const columnMissing = (error) => error?.code === '42703';
const NEEDS_MIGRATION = { message: 'Payout tracking is not set up on this database yet. Run scripts/chit-payouts.sql first.' };

async function loadRound(trx, id, auctionId) {
  const auction = await trx('ticket_auctions').where({ id: auctionId, ticket_id: id }).forUpdate().first();
  if (!auction) return { notFound: true };
  const winner = auction.winner_member_id ? await trx('ticket_members').where({ id: auction.winner_member_id }).first() : null;
  return { auction, winner };
}

// Record that the round's winner has been paid. The amount defaults to the whole
// payout and can be less (anything above it is refused). The cash leaving the
// office is posted to the ledger, and the whole thing happens once per round:
// undo it first to record it again.
export async function POST(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id, auctionId } = params;
    const body = await request.json().catch(() => ({}));

    const result = await db.transaction(async (trx) => {
      const { auction, winner, notFound } = await loadRound(trx, id, auctionId);
      if (notFound) return { status: 404, message: 'Auction round not found.' };
      if (!winner) return { status: 400, message: 'This round has no winner yet. Assign a winner before recording the payout.' };
      if (auction.payout_paid_at) return { status: 409, message: `The payout for round ${auction.round_number} was already recorded. Undo it first to record it again.` };

      const payout = round2(auction.winner_payout);
      const typed = body.amount !== undefined && body.amount !== null && body.amount !== '';
      const amount = typed ? round2(body.amount) : payout;
      if (!(amount > 0)) return { status: 400, message: 'Enter the amount paid to the winner.' };
      if (amount > payout) return { status: 400, message: `LKR ${money(amount)} is more than the round's payout of LKR ${money(payout)}.` };

      await trx('ticket_auctions').where({ id: auctionId }).update({ payout_paid_amount: amount, payout_paid_at: db.fn.now(), payout_paid_by: user.id });
      await postChitPayout(trx, amount);
      await trx('audit_logs').insert({
        actor_id: user.id,
        action_type: 'TICKET_PAYOUT',
        description: `Paid out LKR ${money(amount)} to ${winner.name} for round ${auction.round_number}${amount < payout ? ` (round payout LKR ${money(payout)})` : ''}.`
      });
      return { ok: true, winnerName: winner.name, amount };
    });

    if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });

    const updated = await db('ticket_auctions').where({ id: auctionId }).first();
    return NextResponse.json({ ...updated, winner_name: result.winnerName }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    if (columnMissing(error)) return NextResponse.json(NEEDS_MIGRATION, { status: 409 });
    logError('Record payout error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to record the payout.' }, { status: 500 });
  }
}

// Take the payout record back (it was marked by mistake): the ledger gets the
// exact opposite entry.
export async function DELETE(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id, auctionId } = params;
    const result = await db.transaction(async (trx) => {
      const { auction, winner, notFound } = await loadRound(trx, id, auctionId);
      if (notFound) return { status: 404, message: 'Auction round not found.' };
      if (!auction.payout_paid_at) return { status: 400, message: 'No payout has been recorded for this round.' };

      const amount = round2(auction.payout_paid_amount);
      await trx('ticket_auctions').where({ id: auctionId }).update({ payout_paid_amount: null, payout_paid_at: null, payout_paid_by: null });
      await postChitPayout(trx, amount, { reverse: true });
      await trx('audit_logs').insert({
        actor_id: user.id,
        action_type: 'TICKET_PAYOUT_UNDO',
        description: `Took back the LKR ${money(amount)} payout recorded for ${winner ? winner.name : 'the winner'} in round ${auction.round_number}.`
      });
      return { ok: true, round: auction.round_number };
    });

    if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
    return NextResponse.json({ message: `Payout for round ${result.round} taken back.` });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    if (columnMissing(error)) return NextResponse.json(NEEDS_MIGRATION, { status: 409 });
    logError('Undo payout error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to undo the payout.' }, { status: 500 });
  }
}
