import { describe, it, expect } from 'vitest';
import { groupByCustomer } from './chitCollections.js';

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
    expect(totals).toEqual({ pending: 8650, pending_customers: 1 });
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
    expect(totals).toEqual({ pending: 1900, pending_customers: 1 });
  });

  it('cannot match members without a phone number, so each stays on their own', () => {
    const { customers } = groupByCustomer([
      row({ payment_id: 'a', member_id: 'm1', member_phone: null }),
      row({ payment_id: 'b', member_id: 'm2', member_phone: null })
    ]);
    expect(customers).toHaveLength(2);
  });

  it('returns nothing for no rows', () => {
    expect(groupByCustomer([])).toEqual({ customers: [], totals: { pending: 0, pending_customers: 0 } });
  });
});
