import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { logError } from '@/lib/logger.js';

// Per-term (round) collection summary for one chit group: what was due, what
// has been collected, how many members have paid, and who collected it.
export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }

    const [auctions, payments, [{ count: memberCount }]] = await Promise.all([
      db('ticket_auctions').where({ ticket_id: id }).select('id', 'round_number', 'auction_date', 'amount_per_member'),
      db('ticket_payments')
        .leftJoin('users as collectors', 'ticket_payments.collected_by', 'collectors.id')
        .where('ticket_payments.ticket_id', id)
        .select('ticket_payments.round_number', 'ticket_payments.is_paid', 'ticket_payments.amount', 'ticket_payments.payment_date', 'collectors.name as collector_name'),
      db('ticket_members').where({ ticket_id: id }).count('id as count')
    ]);

    const totalMembers = parseInt(memberCount, 10);
    const rounds = new Map();
    const ensure = (n) => {
      if (!rounds.has(n)) rounds.set(n, { round_number: n, auction_date: null, auction_run: false, members_total: totalMembers, paid_count: 0, due_per_member: null, expected: null, collected: 0, collectors: {} });
      return rounds.get(n);
    };

    for (const a of auctions) {
      const r = ensure(a.round_number);
      r.auction_run = true;
      r.auction_date = a.auction_date;
      r.due_per_member = parseFloat(a.amount_per_member);
      r.expected = r.due_per_member * totalMembers;
    }
    for (const p of payments) {
      const r = ensure(p.round_number);
      if (!p.is_paid) continue;
      const amt = parseFloat(p.amount) || 0;
      r.paid_count += 1;
      r.collected += amt;
      const name = p.collector_name || 'Not recorded';
      r.collectors[name] = r.collectors[name] || { name, count: 0, amount: 0 };
      r.collectors[name].count += 1;
      r.collectors[name].amount += amt;
    }

    const result = [...rounds.values()]
      .sort((a, b) => a.round_number - b.round_number)
      .map((r) => ({ ...r, outstanding: r.expected === null ? null : Math.max(0, r.expected - r.collected), collectors: Object.values(r.collectors) }));

    return NextResponse.json({
      rounds: result,
      totals: {
        collected: result.reduce((s, r) => s + r.collected, 0),
        expected: result.reduce((s, r) => s + (r.expected || 0), 0)
      }
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Chit collection summary error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to build the collection summary.' }, { status: 500 });
  }
}
