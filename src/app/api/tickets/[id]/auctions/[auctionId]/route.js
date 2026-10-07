import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { logError } from '@/lib/logger.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
// pg returns DATE columns as local-midnight Dates, so read the LOCAL parts
// (toISOString would shift a day in timezones ahead of UTC).
const dateOnly = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);

// Edit an already-run round: set, change or clear its winner, and/or
// correct its date. The round's money (bid, payout, per-member amount) is
// NOT touched here — who receives the payout doesn't change what it is. To
// fix a wrong bid, undo the latest round (DELETE) and run it again.
//
// Pass winner_member_id: null to clear the winner.
export async function PATCH(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id, auctionId } = params;
    const body = await request.json();
    const hasWinner = Object.prototype.hasOwnProperty.call(body, 'winner_member_id');
    const hasDate = body.auction_date !== undefined;

    if (!hasWinner && !hasDate) {
      return NextResponse.json({ message: 'Nothing to update.' }, { status: 400 });
    }

    const auction = await db('ticket_auctions').where({ id: auctionId, ticket_id: id }).first();
    if (!auction) {
      return NextResponse.json({ message: 'Auction round not found.' }, { status: 404 });
    }

    const updates = {};
    const notes = [];
    let memberName = null;

    if (hasWinner) {
      const winnerId = body.winner_member_id || null;
      if (winnerId) {
        const member = await db('ticket_members').where({ id: winnerId, ticket_id: id }).first();
        if (!member) {
          return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 400 });
        }
        // Each member wins exactly once across the group's lifetime.
        const alreadyWon = await db('ticket_auctions').where({ ticket_id: id, winner_member_id: winnerId }).whereNot({ id: auctionId }).first();
        if (alreadyWon) {
          return NextResponse.json({ message: `${member.name} has already won round ${alreadyWon.round_number}.` }, { status: 400 });
        }
        memberName = member.name;
      }
      if (winnerId !== auction.winner_member_id) {
        updates.winner_member_id = winnerId;
        notes.push(winnerId ? `winner set to ${memberName}` : 'winner cleared');
      }
    }

    if (hasDate) {
      if (!DATE_RE.test(String(body.auction_date))) {
        return NextResponse.json({ message: 'Auction date is invalid.' }, { status: 400 });
      }
      const current = dateOnly(auction.auction_date);
      if (body.auction_date !== current) {
        updates.auction_date = body.auction_date;
        notes.push(`date ${current} -> ${body.auction_date}`);
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'Nothing to update.' }, { status: 400 });
    }

    await db('ticket_auctions').where({ id: auctionId }).update(updates);
    const [updated] = await db('ticket_auctions')
      .leftJoin('ticket_members', 'ticket_auctions.winner_member_id', 'ticket_members.id')
      .where('ticket_auctions.id', auctionId)
      .select('ticket_auctions.*', 'ticket_members.name as winner_name');

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_AUCTION_UPDATE',
      description: `Edited round ${auction.round_number}: ${notes.join('; ')}.`
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update auction error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update the round.' }, { status: 500 });
  }
}

// Undo the LATEST round that was run (e.g. wrong bid amount). Removes the
// round and its payment-tracking rows, and puts the group back to "about
// to run that round" so it can be run again with the right figures. Only
// the latest round can be undone (earlier rounds are built on), and only
// while none of its payments have been marked paid — otherwise recorded
// collections would vanish.
export async function DELETE(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id, auctionId } = params;
    const auction = await db('ticket_auctions').where({ id: auctionId, ticket_id: id }).first();
    if (!auction) {
      return NextResponse.json({ message: 'Auction round not found.' }, { status: 404 });
    }

    const latest = await db('ticket_auctions').where({ ticket_id: id }).max('round_number as max').first();
    if (auction.round_number !== latest.max) {
      return NextResponse.json({ message: `Only the latest round (round ${latest.max}) can be undone.` }, { status: 400 });
    }

    const [{ count: paidCount }] = await db('ticket_payments').where({ auction_id: auctionId, is_paid: true }).count('id as count');
    if (parseInt(paidCount, 10) > 0) {
      return NextResponse.json({ message: `${paidCount} payment(s) for round ${auction.round_number} are marked as paid. Un-tick them in the Payments Tracker first, then undo the round.` }, { status: 400 });
    }

    const ticket = await db('tickets').where({ id }).first();
    await db.transaction(async (trx) => {
      await trx('ticket_auctions').where({ id: auctionId }).del(); // payment rows cascade
      await trx('tickets').where({ id }).update({
        current_round: auction.round_number,
        status: 'active',
        next_round_date: null
      });
    });

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_AUCTION_UNDO',
      description: `Undid round ${auction.round_number} of ticket group '${ticket?.name}' (bid LKR ${auction.bid_amount}). The round can be run again.`
    });

    return NextResponse.json({ message: `Round ${auction.round_number} undone. You can run it again now.` });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Undo auction error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to undo the round.' }, { status: 500 });
  }
}
