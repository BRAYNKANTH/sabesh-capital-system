import { describe, it, expect } from 'vitest';
import {
  PAWN_GRACE_DAYS,
  getPawnStatusInfo,
  computeForfeitSettlement,
  disbursementEntries,
  accrualEntries,
  paymentEntries,
  forfeitEntries
} from './pawnMath.js';

const sum = (rows, type) => Math.round(rows.filter((r) => r.type === type).reduce((a, r) => a + r.amount, 0) * 100) / 100;
const balanced = (rows) => sum(rows, 'debit') === sum(rows, 'credit');

// Sri Lanka midnight of 2026-10-10 is 2026-10-09T18:30:00Z
const DUE = new Date('2026-10-09T18:30:00Z');
const at = (isoDay) => new Date(`${isoDay}T06:00:00Z`); // midday Sri Lanka time

describe('getPawnStatusInfo', () => {
  it('is on time before and on the due date', () => {
    expect(getPawnStatusInfo({ status: 'active', dueDate: DUE, now: at('2026-10-05') })).toMatchObject({ isOverdue: false, daysOverdue: 0, daysUntilDue: 5 });
    expect(getPawnStatusInfo({ status: 'active', dueDate: DUE, now: at('2026-10-10') })).toMatchObject({ isOverdue: false, daysOverdue: 0, daysUntilDue: 0 });
  });

  it('counts overdue days from the day after the due date', () => {
    expect(getPawnStatusInfo({ status: 'active', dueDate: DUE, now: at('2026-10-11') })).toMatchObject({ isOverdue: true, daysOverdue: 1, canForfeit: false });
    expect(getPawnStatusInfo({ status: 'active', dueDate: DUE, now: at('2026-10-20') }).daysOverdue).toBe(10);
  });

  it('only allows forfeit after the grace period has fully passed', () => {
    const lastGraceDay = getPawnStatusInfo({ status: 'active', dueDate: DUE, now: at('2026-11-09') });
    expect(lastGraceDay.daysOverdue).toBe(PAWN_GRACE_DAYS);
    expect(lastGraceDay.canForfeit).toBe(false);
    expect(getPawnStatusInfo({ status: 'active', dueDate: DUE, now: at('2026-11-10') }).canForfeit).toBe(true);
  });

  it('ignores loans that are not active', () => {
    for (const status of ['redeemed', 'forfeited']) {
      expect(getPawnStatusInfo({ status, dueDate: DUE, now: at('2027-01-01') })).toMatchObject({ isOverdue: false, canForfeit: false });
    }
  });
});

describe('computeForfeitSettlement', () => {
  it('applies interest first, then principal, and returns any surplus', () => {
    expect(computeForfeitSettlement({ proceeds: 60000, principalOutstanding: 40000, interestBalance: 2000 })).toEqual({
      proceeds: 60000, interestApplied: 2000, principalApplied: 40000, surplus: 18000, writtenOffInterest: 0, writtenOffPrincipal: 0
    });
  });

  it('writes off the shortfall when proceeds do not cover the debt', () => {
    expect(computeForfeitSettlement({ proceeds: 30000, principalOutstanding: 40000, interestBalance: 2000 })).toEqual({
      proceeds: 30000, interestApplied: 2000, principalApplied: 28000, surplus: 0, writtenOffInterest: 0, writtenOffPrincipal: 12000
    });
  });

  it('handles proceeds smaller than the interest alone', () => {
    const s = computeForfeitSettlement({ proceeds: 500, principalOutstanding: 40000, interestBalance: 2000 });
    expect(s).toMatchObject({ interestApplied: 500, principalApplied: 0, writtenOffInterest: 1500, writtenOffPrincipal: 40000 });
  });

  it('treats no proceeds as a full write-off', () => {
    expect(computeForfeitSettlement({ proceeds: 0, principalOutstanding: 10000, interestBalance: 300 })).toMatchObject({ surplus: 0, writtenOffInterest: 300, writtenOffPrincipal: 10000 });
  });
});

describe('ledger postings always balance', () => {
  it('disbursement, accrual and payments', () => {
    expect(balanced(disbursementEntries(50000))).toBe(true);
    expect(balanced(accrualEntries(1500))).toBe(true);
    expect(balanced(paymentEntries('interest', 1500))).toBe(true);
    expect(balanced(paymentEntries('principal', 10000))).toBe(true);
  });

  it('forfeit in every scenario', () => {
    for (const proceeds of [0, 500, 2000, 30000, 42000, 60000]) {
      const s = computeForfeitSettlement({ proceeds, principalOutstanding: 40000, interestBalance: 2000 });
      expect(balanced(forfeitEntries(s))).toBe(true);
    }
  });

  it('a forfeit clears both receivables completely', () => {
    const s = computeForfeitSettlement({ proceeds: 30000, principalOutstanding: 40000, interestBalance: 2000 });
    const rows = forfeitEntries(s);
    const credited = (account) => rows.filter((r) => r.account === account && r.type === 'credit').reduce((a, r) => a + r.amount, 0);
    expect(credited('pawn_receivable_principal')).toBe(40000);
    expect(credited('pawn_receivable_interest')).toBe(2000);
  });
});
