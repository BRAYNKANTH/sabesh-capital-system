import { normalizePhone } from '../phone.js';
import { balanceDue, round2 } from './chitPayments.js';

// Overall view by group: how much is still owed in each group and by how many
// people, largest first. Takes the `customers` list produced by groupByCustomer.
export function groupTotals(customers) {
  const groups = new Map();
  for (const c of customers) {
    for (const x of c.chits) {
      if (x.is_paid || !(x.balance > 0)) continue;
      if (!groups.has(x.ticket_id)) groups.set(x.ticket_id, { ticket_id: x.ticket_id, name: x.group_name, code: x.group_code || null, pending: 0, payments: 0, people: new Set() });
      const g = groups.get(x.ticket_id);
      g.pending = round2(g.pending + x.balance);
      g.payments += 1;
      g.people.add(c.key);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ticket_id: g.ticket_id, name: g.name, code: g.code, pending: g.pending, payments: g.payments, people: g.people.size }))
    .sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
}

// Turns payment rows (one per member per round, from any number of chit groups)
// into one entry per PERSON. Members are matched across groups by phone number,
// so someone in two or three groups appears once, with a line for every group
// (and round) they still owe on. A member with no usable phone number cannot be
// matched, so they stay on their own.
//
// Row shape: payment_id, member_id, member_name, member_phone, ticket_id,
// group_name, group_code, round_number, amount_due, amount, is_paid, payment_date,
// collected_by_name.
export function groupByCustomer(rows) {
  const customers = new Map();

  for (const row of rows) {
    const phoneKey = normalizePhone(row.member_phone);
    const key = phoneKey.length >= 9 ? phoneKey : `member:${row.member_id}`;
    if (!customers.has(key)) customers.set(key, { key, name: row.member_name, phone: row.member_phone, chits: [] });

    const paid = round2(row.amount);
    customers.get(key).chits.push({
      payment_id: row.payment_id,
      member_id: row.member_id,
      ticket_id: row.ticket_id,
      group_name: row.group_name,
      group_code: row.group_code || null,
      round_number: row.round_number,
      amount_due: round2(row.amount_due),
      is_paid: !!row.is_paid,
      // Everything collected so far (a part payment too) and what is left.
      amount_paid: paid > 0 ? paid : null,
      balance: balanceDue(row.amount_due, row.amount),
      payment_date: row.payment_date,
      collected_by_name: row.collected_by_name
    });
  }

  const list = [...customers.values()].map((c) => {
    const chits = c.chits.sort((a, b) => a.group_name.localeCompare(b.group_name) || a.round_number - b.round_number);
    const pending = chits.filter((x) => !x.is_paid);
    return {
      ...c,
      chits,
      total_due: round2(chits.reduce((s, x) => s + x.amount_due, 0)),
      total_pending: round2(pending.reduce((s, x) => s + x.balance, 0)),
      pending_count: pending.length
    };
  }).sort((a, b) => (b.pending_count > 0) - (a.pending_count > 0) || a.name.localeCompare(b.name));

  return {
    customers: list,
    totals: {
      pending: round2(list.reduce((s, c) => s + c.total_pending, 0)),
      pending_customers: list.filter((c) => c.pending_count > 0).length
    }
  };
}
