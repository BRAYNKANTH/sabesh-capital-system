/**
 * Pure (database-free) rules for the Pawn Portal: overdue / forfeit timing,
 * forfeit settlement, and the double-entry ledger postings for every pawn
 * money event. Interest itself deliberately reuses the existing
 * loanMath.js functions (calculateInterestPerPeriod / computeAccrualBatch /
 * computeStandardPayment) so a pawn loan's interest behaves exactly like
 * every other loan's — see pawn.js for where they're called.
 */
import { getSriLankaDateString } from '../loanSchedule.js';

// After the due date the customer has this many extra days to pay before
// the pledged item may be forfeited (auctioned, per the pawn form's terms).
export const PAWN_GRACE_DAYS = 30;

export const PAWN_ACCOUNTS = {
  CASH: 'pawn_cash',
  RECEIVABLE_PRINCIPAL: 'pawn_receivable_principal',
  RECEIVABLE_INTEREST: 'pawn_receivable_interest',
  INTEREST_REVENUE: 'pawn_interest_revenue',
  WRITTEN_OFF_EXPENSE: 'pawn_written_off_expense',
  SURPLUS_PAYABLE: 'pawn_surplus_payable'
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Where a pawn loan stands against its due date, in Sri Lanka calendar days.
 * The due date itself is still "on time"; the day after is day 1 overdue.
 * Only an ACTIVE loan can be overdue or forfeitable.
 */
export function getPawnStatusInfo({ status, dueDate, now = new Date() }) {
  if (status !== 'active') {
    return { isOverdue: false, daysOverdue: 0, daysUntilDue: null, canForfeit: false, daysUntilForfeitable: null };
  }
  const diff = dayNumber(getSriLankaDateString(now)) - dayNumber(getSriLankaDateString(new Date(dueDate)));
  const daysOverdue = Math.max(0, diff);
  return {
    isOverdue: diff > 0,
    daysOverdue,
    daysUntilDue: Math.max(0, -diff),
    canForfeit: daysOverdue > PAWN_GRACE_DAYS,
    daysUntilForfeitable: diff > PAWN_GRACE_DAYS ? 0 : PAWN_GRACE_DAYS + 1 - Math.max(0, diff)
  };
}

/**
 * How auction/forfeit proceeds settle the debt: interest first, then
 * principal. Anything left over is owed back to the customer (surplus);
 * anything still unpaid is written off.
 */
export function computeForfeitSettlement({ proceeds, principalOutstanding, interestBalance }) {
  const p = round2(Math.max(0, Number(proceeds) || 0));
  const principal = round2(principalOutstanding);
  const interest = round2(interestBalance);

  const interestApplied = round2(Math.min(p, interest));
  const principalApplied = round2(Math.min(p - interestApplied, principal));
  const surplus = round2(p - interestApplied - principalApplied);
  const writtenOffInterest = round2(interest - interestApplied);
  const writtenOffPrincipal = round2(principal - principalApplied);

  return { proceeds: p, interestApplied, principalApplied, surplus, writtenOffInterest, writtenOffPrincipal };
}

const entry = (account, type, amount) => ({ account, type, amount: round2(amount) });

/** Cash handed to the customer. */
export function disbursementEntries(principal) {
  return [
    entry(PAWN_ACCOUNTS.RECEIVABLE_PRINCIPAL, 'debit', principal),
    entry(PAWN_ACCOUNTS.CASH, 'credit', principal)
  ];
}

/** Interest that has built up but not yet been paid. */
export function accrualEntries(amount) {
  return [
    entry(PAWN_ACCOUNTS.RECEIVABLE_INTEREST, 'debit', amount),
    entry(PAWN_ACCOUNTS.INTEREST_REVENUE, 'credit', amount)
  ];
}

/** Customer pays interest or principal in cash. */
export function paymentEntries(paymentType, amount) {
  return [
    entry(PAWN_ACCOUNTS.CASH, 'debit', amount),
    entry(paymentType === 'interest' ? PAWN_ACCOUNTS.RECEIVABLE_INTEREST : PAWN_ACCOUNTS.RECEIVABLE_PRINCIPAL, 'credit', amount)
  ];
}

/** Item auctioned/forfeited: proceeds applied, surplus owed back, shortfall written off. */
export function forfeitEntries(settlement) {
  const rows = [];
  const s = settlement;
  if (s.proceeds > 0) rows.push(entry(PAWN_ACCOUNTS.CASH, 'debit', s.proceeds));
  if (s.interestApplied > 0) rows.push(entry(PAWN_ACCOUNTS.RECEIVABLE_INTEREST, 'credit', s.interestApplied));
  if (s.principalApplied > 0) rows.push(entry(PAWN_ACCOUNTS.RECEIVABLE_PRINCIPAL, 'credit', s.principalApplied));
  if (s.surplus > 0) rows.push(entry(PAWN_ACCOUNTS.SURPLUS_PAYABLE, 'credit', s.surplus));
  if (s.writtenOffInterest > 0) {
    rows.push(entry(PAWN_ACCOUNTS.WRITTEN_OFF_EXPENSE, 'debit', s.writtenOffInterest));
    rows.push(entry(PAWN_ACCOUNTS.RECEIVABLE_INTEREST, 'credit', s.writtenOffInterest));
  }
  if (s.writtenOffPrincipal > 0) {
    rows.push(entry(PAWN_ACCOUNTS.WRITTEN_OFF_EXPENSE, 'debit', s.writtenOffPrincipal));
    rows.push(entry(PAWN_ACCOUNTS.RECEIVABLE_PRINCIPAL, 'credit', s.writtenOffPrincipal));
  }
  return rows;
}
