import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { groupByCustomer } from '@/lib/services/chitCollections.js';
import { logError } from '@/lib/logger.js';

// Everything still to collect, one entry per person. Someone who is in more than
// one chit group (matched by phone number) appears once, with a line for every
// group and round they still owe on, and a combined total.
//
// A line is included when it still has a balance (any round whose auction has
// been run), plus each group's most recent round even when it is fully paid, so
// the screen can show who has already paid. Rounds whose auction has not been
// run yet have no amount due and are collected in the group's own Payments tab.
export async function GET(request) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    // select('*'): the short code column may not exist until the codes migration has been run.
    const tickets = await db('tickets').select('*');
    const groupName = new Map(tickets.map((t) => [t.id, t.name]));
    const groupCode = new Map(tickets.map((t) => [t.id, t.code || null]));
    // The round whose auction was run most recently: current_round - 1, or the
    // last round once the group has completed.
    const latest = tickets
      .map((t) => ({ id: t.id, round: t.status === 'completed' ? t.member_count : t.current_round - 1 }))
      .filter((x) => x.round >= 1);

    const rows = await db('ticket_payments')
      .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
      .join('ticket_auctions', 'ticket_payments.auction_id', 'ticket_auctions.id')
      .leftJoin('users as collectors', 'ticket_payments.collected_by', 'collectors.id')
      .where(function () {
        this.where('ticket_payments.is_paid', false);
        for (const g of latest) this.orWhere({ 'ticket_payments.ticket_id': g.id, 'ticket_payments.round_number': g.round });
      })
      .select(
        'ticket_payments.id as payment_id', 'ticket_payments.member_id', 'ticket_payments.ticket_id', 'ticket_payments.round_number',
        'ticket_payments.is_paid', 'ticket_payments.amount', 'ticket_payments.payment_date',
        'ticket_members.name as member_name', 'ticket_members.phone as member_phone',
        'ticket_auctions.amount_per_member as amount_due', 'collectors.name as collected_by_name'
      );

    return NextResponse.json(groupByCustomer(rows.map((r) => ({ ...r, group_name: groupName.get(r.ticket_id) || '', group_code: groupCode.get(r.ticket_id) || null }))));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Chit collection list error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to load the chit collections.' }, { status: 500 });
  }
}
