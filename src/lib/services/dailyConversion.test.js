import { describe, it, expect } from 'vitest';
import { planDailyConversion, conversionLedgerRows } from './dailyConversion.js';

const baseLoan = {
  id: 'L1',
  status: 'active',
  principal_amount: '100000.00',
  interest_rate: '5.00',
  principal_outstanding: '100000.00',
  interest_balance: '0.00',
  collection_mode: 'open_ended',
  duration_periods: null,
  is_flat_installment: false,
  daily_installment_amount: null,
  principal_per_day: null,
  interest_per_day: null,
  created_at: '2026-09-30T18:30:00.000Z', // 1 Oct 2026, Sri Lanka midnight
  last_accrual_date: null,
  next_accrual_date: null,
  maturity_date: null,
};
const now = new Date('2026-10-31T06:00:00.000Z'); // 31 Oct 2026, 11:30 Sri Lanka

describe('planDailyConversion', () => {
  it('skips loans that are already daily or not active', () => {
    expect(planDailyConversion({ ...baseLoan, interest_type: 'daily' }, { now }).skip).toBe(true);
    const closed = planDailyConversion({ ...baseLoan, interest_type: 'weekly', status: 'fully_paid' }, { now });
    expect(closed.skip).toBe(true);
    expect(closed.reason).toMatch(/fully_paid/);
  });

  it('recalculates an open-ended monthly loan as daily, keeping payments already made', () => {
    // Old monthly model: 1 accrual of 5,000 so far, 2,000 of interest paid.
    const loan = { ...baseLoan, interest_type: 'monthly', interest_balance: '3000.00' };
    const plan = planDailyConversion(loan, { totalPaid: 2000, interestPaid: 2000, totalAccrued: 5000, now });
    expect(plan.skip).toBe(false);
    expect(plan.mode).toBe('open_ended');
    // 5,000 a month / 30 = 166.67 a day; 30 daily accruals from 2 Oct to 31 Oct.
    const expectedAccrued = 30 * (5000 / 30);
    expect(plan.after.interest_balance).toBeCloseTo(3000 + (expectedAccrued - 5000), 2);
    expect(plan.after.interest_type).toBe('daily');
    expect(plan.after.is_flat_installment).toBe(false);
    expect(plan.after.principal_outstanding).toBe(100000);
    expect(new Date(plan.after.next_accrual_date).getTime()).toBeGreaterThan(now.getTime());
  });

  it('never lets the interest balance go negative and says so', () => {
    const loan = { ...baseLoan, interest_type: 'weekly', interest_balance: '0.00' };
    const plan = planDailyConversion(loan, { totalPaid: 99999, interestPaid: 99999, totalAccrued: 99999, now });
    expect(plan.after.interest_balance).toBe(0);
    expect(plan.warnings.join(' ')).toMatch(/paid ahead/);
  });

  it('turns a 2-month fixed monthly loan into a 62-day flat installment loan', () => {
    const loan = { ...baseLoan, interest_type: 'monthly', collection_mode: 'fixed_term', duration_periods: 2, interest_balance: '10000.00' };
    const plan = planDailyConversion(loan, { totalPaid: 0, interestPaid: 0, totalAccrued: 10000, now });
    expect(plan.mode).toBe('fixed_term');
    expect(plan.after.duration_periods).toBe(62);
    expect(plan.after.is_flat_installment).toBe(true);
    // (100,000 + 5% x 2 months) / 60 nominal days
    expect(plan.after.daily_installment_amount).toBeCloseTo(110000 / 60, 2);
    expect(plan.after.principal_outstanding).toBe(100000);
    // whole term's interest booked upfront: 62 x daily installment - principal
    expect(plan.after.interest_balance).toBeCloseTo((110000 / 60) * 62 - 100000, 1);
  });

  it('applies collections so far across principal and interest in the loan\'s fixed ratio', () => {
    const loan = { ...baseLoan, interest_type: 'monthly', collection_mode: 'fixed_term', duration_periods: 1, interest_balance: '5000.00' };
    const plan = planDailyConversion(loan, { totalPaid: 10000, interestPaid: 0, totalAccrued: 5000, now });
    const dia = 105000 / 30;
    const share = (100000 / 31) / dia;
    expect(plan.after.duration_periods).toBe(31);
    expect(plan.after.principal_outstanding).toBeCloseTo(100000 - 10000 * share, 1);
    expect(plan.after.principal_outstanding + plan.after.interest_balance).toBeCloseTo(dia * 31 - 10000, 1);
  });

  it('converts weeks to whole months of 31 days and flags the rest for manual review', () => {
    const eight = planDailyConversion({ ...baseLoan, interest_type: 'weekly', collection_mode: 'fixed_term', duration_periods: 8 }, { totalPaid: 0, interestPaid: 0, totalAccrued: 0, now });
    expect(eight.after.duration_periods).toBe(62);
    const six = planDailyConversion({ ...baseLoan, interest_type: 'weekly', collection_mode: 'fixed_term', duration_periods: 6 }, { totalPaid: 0, interestPaid: 0, totalAccrued: 0, now });
    expect(six.skip).toBe(true);
    expect(six.reason).toMatch(/whole number of months/);
  });

  it('marks a fixed-term loan fully paid when collections already cover the new term', () => {
    const loan = { ...baseLoan, interest_type: 'monthly', collection_mode: 'fixed_term', duration_periods: 1 };
    const plan = planDailyConversion(loan, { totalPaid: 200000, interestPaid: 0, totalAccrued: 0, now });
    expect(plan.after.status).toBe('fully_paid');
    expect(plan.after.principal_outstanding).toBe(0);
    expect(plan.after.interest_balance).toBe(0);
  });
});

describe('conversionLedgerRows', () => {
  const sum = (rows, type) => rows.filter(r => r.type === type).reduce((s, r) => s + r.amount, 0);

  it('balances when the total owed goes up', () => {
    const rows = conversionLedgerRows('L1', 0, 1500);
    expect(rows).toEqual([
      { loan_id: 'L1', account: 'loan_receivable_interest', type: 'debit', amount: 1500 },
      { loan_id: 'L1', account: 'interest_revenue', type: 'credit', amount: 1500 },
    ]);
    expect(sum(rows, 'debit')).toBe(sum(rows, 'credit'));
  });

  it('balances when the total owed goes down', () => {
    const rows = conversionLedgerRows('L1', 0, -800);
    expect(rows.find(r => r.account === 'interest_revenue').type).toBe('debit');
    expect(sum(rows, 'debit')).toBe(sum(rows, 'credit'));
  });

  it('nets to zero revenue when only the principal/interest split moves', () => {
    const rows = conversionLedgerRows('L1', 400, -400);
    expect(rows.find(r => r.account === 'interest_revenue')).toBeUndefined();
    expect(sum(rows, 'debit')).toBe(sum(rows, 'credit'));
  });
});
