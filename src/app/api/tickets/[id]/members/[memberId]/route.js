import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { logError } from '@/lib/logger.js';

async function loadMember(id, memberId) {
  return db('ticket_members').where({ id: memberId, ticket_id: id }).first();
}

// Edit a member's name and/or phone number.
export async function PATCH(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id, memberId } = params;
    const body = await request.json();

    const member = await loadMember(id, memberId);
    if (!member) {
      return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    }

    const updates = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ message: 'Member name cannot be empty.' }, { status: 400 });
      if (name.length > 100) return NextResponse.json({ message: 'Member name must be 100 characters or fewer.' }, { status: 400 });
      updates.name = name;
    }
    if (body.phone !== undefined) {
      const phone = body.phone === null ? '' : String(body.phone).trim();
      if (phone.length > 20) return NextResponse.json({ message: 'Phone number must be 20 characters or fewer.' }, { status: 400 });
      updates.phone = phone || null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'Nothing to update.' }, { status: 400 });
    }

    const [updated] = await db('ticket_members').where({ id: memberId }).update(updates).returning('*');
    const ticket = await db('tickets').where({ id }).first();

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_MEMBER_UPDATE',
      description: `Edited member '${member.name}' in ticket group '${ticket?.name}': ${Object.entries(updates).map(([k, v]) => `${k} '${member[k] || ''}' -> '${v || ''}'`).join('; ')}.`
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update ticket member error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update member.' }, { status: 500 });
  }
}

// Remove a member from the roster. Deliberately refused when it would
// silently change money records:
//  - someone who already won a round (their payout is on record) — change
//    that round's winner first;
//  - someone with payments marked as PAID — un-tick those in the Payments
//    Tracker first if they were ticked by mistake.
// Their unpaid payment rows for past rounds are removed along with them
// (ON DELETE CASCADE), which is the whole point of removing them.
export async function DELETE(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id, memberId } = params;
    const member = await loadMember(id, memberId);
    if (!member) {
      return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    }

    const won = await db('ticket_auctions').where({ ticket_id: id, winner_member_id: memberId }).first();
    if (won) {
      return NextResponse.json({ message: `${member.name} won round ${won.round_number}, so they can't be removed. Change the winner of that round first (Past Auctions History).` }, { status: 400 });
    }

    const [{ count: paidCount }] = await db('ticket_payments').where({ ticket_id: id, member_id: memberId, is_paid: true }).count('id as count');
    if (parseInt(paidCount, 10) > 0) {
      return NextResponse.json({ message: `${member.name} has ${paidCount} payment(s) marked as paid, so they can't be removed. If those were marked by mistake, un-tick them in the Payments Tracker first.` }, { status: 400 });
    }

    const [{ count: unpaidCount }] = await db('ticket_payments').where({ ticket_id: id, member_id: memberId }).count('id as count');
    const ticket = await db('tickets').where({ id }).first();

    await db('ticket_members').where({ id: memberId }).del();

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_MEMBER_DELETE',
      description: `Removed member '${member.name}' from ticket group '${ticket?.name}' (${unpaidCount} unpaid payment record(s) removed with them).`
    });

    return NextResponse.json({ message: `${member.name} removed from the group.` });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Delete ticket member error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to remove member.' }, { status: 500 });
  }
}
