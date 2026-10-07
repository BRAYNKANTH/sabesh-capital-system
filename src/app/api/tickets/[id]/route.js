import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { logError } from '@/lib/logger.js';

export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const ticket = await db('tickets').where({ id }).first();

    if (!ticket) {
      return NextResponse.json({ message: 'Ticket not found.' }, { status: 404 });
    }

    return NextResponse.json(ticket);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Get ticket error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to fetch ticket details.' }, { status: 500 });
  }
}

// Permanently delete a ticket group — unlike loans (which deliberately
// block deleting anything with payment history via ON DELETE RESTRICT),
// tickets/members/auctions/payments are wired with ON DELETE CASCADE, so
// this genuinely removes the whole group's history: every member, every
// round's auction record, every payment-tracking row. That's an
// intentional, real capability here (e.g. a group created by mistake, or
// test data), not an oversight — but it's permanent, so the frontend
// requires typing the group's name to confirm before calling this.
export async function DELETE(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }

    const [{ count: memberCount }] = await db('ticket_members').where({ ticket_id: id }).count('id as count');
    const [{ count: auctionCount }] = await db('ticket_auctions').where({ ticket_id: id }).count('id as count');

    await db('tickets').where({ id }).del();

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_DELETE',
      description: `Permanently deleted ticket group '${ticket.name}' (${memberCount} member(s), ${auctionCount} round(s) of history removed).`
    });

    return NextResponse.json({ message: `'${ticket.name}' deleted.` });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Delete ticket error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to delete ticket group.' }, { status: 500 });
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
// pg returns DATE columns as local-midnight Dates, so read the LOCAL parts
// (toISOString would shift a day in timezones ahead of UTC).
const dateOnly = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);

// Edit a chit group. Every field is optional — send only what changed.
//
// Money rules (important): total_value, host_fee_type and host_fee_value
// are read fresh each time a round is RUN (see the auctions route), and
// every round stores its own amounts when it's run. So changing them here
// only affects rounds that haven't been run yet — rounds already run keep
// exactly the amounts that were collected at the time. To re-do a round
// that was run with wrong figures, undo it (DELETE on the auction) and
// run it again.
//
// member_count: can go up (adds rounds onto the end — reopening a finished
// group) or down, but never below the people already on the roster or the
// rounds already run.
export async function PATCH(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const body = await request.json();

    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }

    const updates = {};
    const changes = [];
    const bad = (message) => NextResponse.json({ message }, { status: 400 });

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return bad('Group name cannot be empty.');
      if (name.length > 100) return bad('Group name must be 100 characters or fewer.');
      if (name !== ticket.name) { updates.name = name; changes.push(`name '${ticket.name}' -> '${name}'`); }
    }

    if (body.total_value !== undefined) {
      const total = parseFloat(body.total_value);
      if (isNaN(total) || total <= 0) return bad('Total value must be a positive number.');
      if (total !== parseFloat(ticket.total_value)) { updates.total_value = total; changes.push(`total value ${ticket.total_value} -> ${total}`); }
    }

    const feeType = body.host_fee_type !== undefined ? body.host_fee_type : ticket.host_fee_type;
    if (!['percentage', 'fixed'].includes(feeType)) return bad("Host fee type must be 'percentage' or 'fixed'.");
    if (body.host_fee_type !== undefined && feeType !== ticket.host_fee_type) {
      updates.host_fee_type = feeType; changes.push(`host fee type ${ticket.host_fee_type} -> ${feeType}`);
    }
    if (body.host_fee_value !== undefined || body.host_fee_type !== undefined) {
      const fee = body.host_fee_value !== undefined ? parseFloat(body.host_fee_value) : parseFloat(ticket.host_fee_value);
      if (isNaN(fee) || fee < 0) return bad('Host fee must be zero or more.');
      if (feeType === 'percentage' && fee > 100) return bad('A percentage host fee cannot be more than 100.');
      if (fee !== parseFloat(ticket.host_fee_value)) { updates.host_fee_value = fee; changes.push(`host fee ${ticket.host_fee_value} -> ${fee}`); }
    }

    if (body.start_date !== undefined) {
      if (!DATE_RE.test(String(body.start_date))) return bad('Start date is invalid.');
      const current = dateOnly(ticket.start_date);
      if (body.start_date !== current) { updates.start_date = body.start_date; changes.push(`start date ${current} -> ${body.start_date}`); }
    }

    if (body.next_round_date !== undefined) {
      const next = body.next_round_date === null || body.next_round_date === '' ? null : String(body.next_round_date);
      if (next !== null && !DATE_RE.test(next)) return bad('Next round date is invalid.');
      const current = dateOnly(ticket.next_round_date);
      if (next !== current) { updates.next_round_date = next; changes.push(`next round date ${current || 'none'} -> ${next || 'none'}`); }
    }

    if (body.member_count !== undefined) {
      const newCount = parseInt(body.member_count, 10);
      if (isNaN(newCount) || newCount <= 0) return bad('Member count must be a positive number.');
      if (newCount !== ticket.member_count) {
        const completedRounds = ticket.status === 'completed' ? ticket.member_count : ticket.current_round - 1;
        const [{ count }] = await db('ticket_members').where({ ticket_id: id }).count('id as count');
        const onRoster = parseInt(count, 10);
        if (newCount < onRoster) {
          return bad(`There are ${onRoster} members on the roster — remove ${onRoster - newCount} member(s) first, or choose ${onRoster} or more.`);
        }
        if (newCount < completedRounds) {
          return bad(`${completedRounds} round(s) have already been run, so the member count can't go below ${completedRounds}.`);
        }
        updates.member_count = newCount;
        changes.push(`member count ${ticket.member_count} -> ${newCount}`);

        if (newCount === completedRounds) {
          // Every remaining round is already done — the group is finished.
          updates.status = 'completed';
          updates.current_round = newCount;
          changes.push('group marked completed');
        } else if (ticket.status === 'completed') {
          // Rounds were added back onto a finished group: the next round
          // to run is the one after the last completed round.
          updates.status = 'active';
          updates.current_round = completedRounds + 1;
          changes.push(`reopened — next round is ${completedRounds + 1}`);
        }
      }
    }

    if (changes.length === 0) {
      return bad('Nothing to update.');
    }

    const [updated] = await db('tickets').where({ id }).update(updates).returning('*');

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_UPDATE',
      description: `Edited ticket group '${ticket.name}': ${changes.join('; ')}.`
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update ticket error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update ticket group.' }, { status: 500 });
  }
}
