import { describe, it, expect } from 'vitest';
import { groupByCustomer, groupTotals } from './chitCollections.js';

const row = (o) => ({
  payment_id: 'p', member_id: 'm', member_name: 'Brayn', member_phone: '0707752433', ticket_id: 't1', group_name: 'Group A',
  round_number: 2, amount_due: '1900.00', amount: null, is_paid: false, payment_date: null, collected_by_name: null, ...o
});

describe('groupByCustomer', () => {
  it('shows a person in two groups once, with a line for each group', () => {
    const { customers, totals } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', ticket_id: 't1', group_name: 'Group A', amount_due: '1900.00' }),
      row({ payment_id: 'b', member_id: 'm2', ticket_id: 't2', group_name: 'Group B', amount_due: '6750.00', member_phone: '+94 70 775 2433' })
    ]);
    expect(customers).toHaveLength(1);
    expect(customers[0].chits.map((c) => c.group_name)).toEqual(['Group A', 'Group B']);
    expect(customers[0].total_pending).toBe(8650);
    expect(customers[0].pending_count).toBe(2);
    expect(totals).toMatchObject({ pending: 8650, pending_customers: 1, overdue: 0, overdue_customers: 0 });
  });

  it('keeps each line\'s group code so same-named groups can be told apart', () => {
    const { customers } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', ticket_id: 't1', group_name: 'Sabesh micro credit', group_code: 'SMC' }),
      row({ payment_id: 'b', member_id: 'm2', ticket_id: 't2', group_name: 'Sabesh micro credit', group_code: 'SMC-2' }),
      row({ payment_id: 'c', member_id: 'm3', ticket_id: 't3', group_name: 'Old group' })
    ]);
    const codes = customers[0].chits.map((c) => c.group_code);
    expect(codes).toHaveLength(3);
    expect(codes).toEqual(expect.arrayContaining(['SMC', 'SMC-2', null]));
  });

  it('counts only what is still owed, so a part payment leaves a balance', () => {
    const { customers } = groupByCustomer([row({ amount: '4000.00', amount_due: '6750.00' })]);
    expect(customers[0].chits[0].amount_paid).toBe(4000);
    expect(customers[0].chits[0].balance).toBe(2750);
    expect(customers[0].total_pending).toBe(2750);
  });

  it('lists every round a person still owes on in the same group', () => {
    const { customers } = groupByCustomer([
      row({ payment_id: 'r2', round_number: 2 }),
      row({ payment_id: 'r1', round_number: 1, amount: '500.00' })
    ]);
    expect(customers[0].chits.map((c) => c.round_number)).toEqual([1, 2]);
    expect(customers[0].total_pending).toBe(1400 + 1900);
  });

  it('keeps fully paid people but sorts those who still owe first', () => {
    const { customers, totals } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', member_name: 'Aaa', member_phone: '0771111111', amount: '1900.00', is_paid: true }),
      row({ payment_id: 'b', member_id: 'm2', member_name: 'Zzz', member_phone: '0772222222' })
    ]);
    expect(customers.map((c) => c.name)).toEqual(['Zzz', 'Aaa']);
    expect(customers[1].pending_count).toBe(0);
    expect(customers[1].total_pending).toBe(0);
    expect(totals).toMatchObject({ pending: 1900, pending_customers: 1 });
  });

  it('cannot match members without a phone number, so each stays on their own', () => {
    const { customers } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', member_phone: null }),
      row({ payment_id: 'b', member_id: 'm2', member_phone: null })
    ]);
    expect(customers).toHaveLength(2);
  });

  it('returns nothing for no rows', () => {
    expect(groupByCustomer([])).toEqual({ customers: [], totals: { pending: 0, pending_customers: 0, overdue: 0, overdue_customers: 0 } });
  });
});

describe('groupTotals', () => {
  const rows = [
    row({ payment_id: 'a', member_id: 'm1', ticket_id: 't1', group_name: 'Group A', group_code: 'A', amount_due: '1000.00' }),
    row({ payment_id: 'b', member_id: 'm1b', ticket_id: 't1', group_name: 'Group A', group_code: 'A', amount_due: '1000.00', round_number: 3, amount: '400.00' }),
    row({ payment_id: 'c', member_id: 'm2', ticket_id: 't2', group_name: 'Group B', group_code: 'B', amount_due: '5000.00', member_phone: '0771234567', member_name: 'Other' }),
    row({ payment_id: 'd', member_id: 'm3', ticket_id: 't1', group_name: 'Group A', group_code: 'A', amount_due: '1000.00', amount: '1000.00', is_paid: true, member_phone: '0779999999', member_name: 'Paid up' })
  ];

  it('totals what is still owed per group, largest first', () => {
    const totals = groupTotals(groupByCustomer(rows).customers);
    expect(totals.map((g) => [g.code, g.pending])).toEqual([['B', 5000], ['A', 1600]]);
  });

  it('counts people once per group and ignores paid lines', () => {
    const totals = groupTotals(groupByCustomer(rows).customers);
    const a = totals.find((g) => g.code === 'A');
    expect(a.people).toBe(1);     // the same person (same phone) owes on two rounds
    expect(a.payments).toBe(2);
  });

  it('is empty when nobody owes anything', () => {
    expect(groupTotals(groupByCustomer([rows[3]]).customers)).toEqual([]);
    expect(groupTotals([])).toEqual([]);
  });
});

describe('overdue', () => {
  const today = '2026-10-31';
  it('marks unpaid lines more than 7 days after the auction, with the days late', () => {
    const { customers, totals } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', auction_date: '2026-10-10', amount_due: '1000.00', amount: '400.00' }), // 21 days -> 14 late, balance 600
      row({ payment_id: 'b', member_id: 'm1b', auction_date: '2026-10-28', amount_due: '1000.00' })                  // 3 days -> on time
    ], { today });
    const c = customers[0];
    expect(c.chits.find((x) => x.payment_id === 'a').overdue_days).toBe(14);
    expect(c.chits.find((x) => x.payment_id === 'b').overdue_days).toBe(0);
    expect(c.overdue_count).toBe(1);
    expect(c.overdue_amount).toBe(600);
    expect(c.max_overdue_days).toBe(14);
    expect(totals.overdue).toBe(600);
    expect(totals.overdue_customers).toBe(1);
  });

  it('never marks a paid line overdue, and nothing is overdue without a date for today', () => {
    const paid = groupByCustomer([row({ auction_date: '2026-01-01', amount: '1900.00', is_paid: true })], { today });
    expect(paid.customers[0].overdue_count).toBe(0);
    const noToday = groupByCustomer([row({ auction_date: '2026-01-01' })]);
    expect(noToday.customers[0].overdue_count).toBe(0);
  });

  it('lists people with overdue payments before others who owe', () => {
    const { customers } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', member_name: 'Aaa', member_phone: '0771111111', auction_date: '2026-10-29' }),
      row({ payment_id: 'b', member_id: 'm2', member_name: 'Zzz', member_phone: '0772222222', auction_date: '2026-09-01' })
    ], { today });
    expect(customers.map((c) => c.name)).toEqual(['Zzz', 'Aaa']);
  });
});
