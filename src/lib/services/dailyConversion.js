import { calculateInterestPerPeriod, computeAccrualBatch } from './loanMath.js';
import { addInterval } from '../loanSchedule.js';

// Pure planning logic for converting an already-registered weekly/monthly loan
// to a daily loan (see scripts/convert-loans-to-daily.js). Nothing here touches
// the database, so every rule can be unit tested and the dry-run report is
// exactly what --apply will do.
//
//   Open-ended loan  -> open-ended daily loan. Interest is recalculated from the
//                       loan's start as daily accruals (monthly rate / 30 per
//                       day on the original principal, exactly what the nightly
//                       cron would have posted had the loan always been daily).
//                       Whatever was paid, penalised or adjusted before is kept:
//                       new balance = old balance + (new accrued - old accrued).
//   Fixed-term loan  -> flat daily-installment loan (the app's Daily + Fixed
//                       Term product), with the term converted to months of 31
//                       days: 1 month = 31 days, 2 months = 62, and so on.
//                       Interest for the whole term is booked upfront and
//                       everything already collected is applied across
//                       principal and interest in the loan's fixed ratio.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const CONVERTIBLE_STATUS = 'active';

/**
 * How many whole months a registered fixed term means, or null when it is not
 * clear. Staff entered terms inconsistently: sometimes months (2), sometimes
 * days (60, which is 2 months; 62 is already the 31-day form). So a multiple of
 * 31 or 30 is read as days; a small number is read in the loan's own unit
 * (months for monthly loans, weeks for weekly loans, 4 weeks = 1 month).
 */
export function termInMonths(interestType, duration) {
  if (!Number.isInteger(duration) || duration <= 0) return null;
  if (duration >= 31 && duration % 31 === 0) return duration / 31;
  if (duration >= 30 && duration % 30 === 0) return duration / 30;
  if (interestType === 'monthly' && duration <= 27) return duration;
  if (interestType === 'weekly' && duration >= 4 && duration <= 24 && duration % 4 === 0) return duration / 4;
  return null;
}

/**
 * @param loan  row from `loans`
 * @param ctx   { totalPaid, interestPaid, totalAccrued, now }
 *              totalPaid    - SUM(transactions.amount) for the loan
 *              interestPaid - SUM(transactions.amount) where payment_type = 'interest'
 *              totalAccrued - SUM(interest_accruals.amount_accrued) for the loan
 */
export function planDailyConversion(loan, ctx) {
  if (loan.interest_type === 'daily') return { skip: true, reason: 'Already a daily loan.' };
  if (!['weekly', 'monthly'].includes(loan.interest_type)) return { skip: true, reason: `Unknown interest type '${loan.interest_type}'.` };
  if (loan.status !== CONVERTIBLE_STATUS) {
    return { skip: true, reason: `Status is '${loan.status}'; only active loans are converted. Review it separately.` };
  }

  const principal = Number(loan.principal_amount);
  const rate = Number(loan.interest_rate);
  const before = {
    status: loan.status,
    interest_type: loan.interest_type,
    collection_mode: loan.collection_mode,
    duration_periods: loan.duration_periods,
    is_flat_installment: !!loan.is_flat_installment,
    daily_installment_amount: loan.daily_installment_amount,
    principal_per_day: loan.principal_per_day,
    interest_per_day: loan.interest_per_day,
    principal_outstanding: round2(loan.principal_outstanding),
    interest_balance: round2(loan.interest_balance),
    last_accrual_date: loan.last_accrual_date,
    next_accrual_date: loan.next_accrual_date,
    maturity_date: loan.maturity_date,
  };
  const warnings = [];

  let after;
  let mode;

  if (loan.collection_mode === 'fixed_term') {
    mode = 'fixed_term';
    const duration = Number(loan.duration_periods);
    const months = termInMonths(loan.interest_type, duration);
    if (months === null) {
      return {
        skip: true,
        reason: `Fixed term of ${duration} (${loan.interest_type} loan) is not clearly a whole number of months, so it cannot become a 31-day multiple automatically. Decide its term by hand.`,
      };
    }

    const periods = months * 31;
    const nominalDays = periods - months;
    const totalInterest = principal * (rate / 100) * months;
    const dailyInstallment = (principal + totalInterest) / nominalDays;
    const principalPerDay = principal / periods;
    const interestPerDay = dailyInstallment - principalPerDay;
    const interestTotal = interestPerDay * periods;
    const share = principalPerDay / dailyInstallment; // principal's share of every payment

    const collected = Number(ctx.totalPaid) || 0;
    // Penalties/adjustments sitting in the old interest balance on top of
    // normal accrual-minus-payments are carried over, not lost.
    const extra = Number(loan.interest_balance) - ((Number(ctx.totalAccrued) || 0) - (Number(ctx.interestPaid) || 0));
    const carried = extra > 0.01 ? extra : 0;
    if (carried > 0) warnings.push(`Carries over LKR ${round2(carried)} of penalties/adjustments.`);

    let newPrincipal = Math.max(0, principal - collected * share);
    let newInterest = Math.max(0, interestTotal - collected * (1 - share)) + carried;
    let status = loan.status;
    if (newPrincipal <= 0.005) {
      newPrincipal = 0;
      newInterest = 0;
      status = 'fully_paid';
      warnings.push('Collections to date cover the whole new term, so the loan becomes fully paid.');
    }

    after = {
      interest_type: 'daily',
      collection_mode: 'fixed_term',
      duration_periods: periods,
      is_flat_installment: true,
      daily_installment_amount: round2(dailyInstallment),
      principal_per_day: round2(principalPerDay),
      interest_per_day: round2(interestPerDay),
      principal_outstanding: round2(newPrincipal),
      interest_balance: round2(newInterest),
      status,
      last_accrual_date: loan.last_accrual_date,
      next_accrual_date: addInterval(new Date(loan.created_at), 'daily'),
      maturity_date: addInterval(new Date(loan.created_at), 'daily', periods - 1),
    };
  } else {
    mode = 'open_ended';
    const perDay = calculateInterestPerPeriod(principal, rate, 'daily');
    const batch = computeAccrualBatch({
      interestType: 'daily',
      interestPerPeriod: perDay,
      startingInterestBalance: 0,
      nextAccrualDate: addInterval(new Date(loan.created_at), 'daily'),
      now: ctx.now,
      maturityDate: null,
      maxPeriods: 20000,
    });
    const newAccrued = batch.totalAccrued;
    const oldAccrued = Number(ctx.totalAccrued) || 0;
    let newInterest = Number(loan.interest_balance) + (newAccrued - oldAccrued);
    if (newInterest < 0) {
      warnings.push(`Recalculated interest is LKR ${round2(-newInterest)} less than what was already paid, so the interest balance is set to 0. The borrower has paid ahead.`);
      newInterest = 0;
    }

    after = {
      interest_type: 'daily',
      collection_mode: loan.collection_mode,
      duration_periods: loan.duration_periods,
      is_flat_installment: false,
      daily_installment_amount: null,
      principal_per_day: null,
      interest_per_day: null,
      principal_outstanding: before.principal_outstanding,
      interest_balance: round2(newInterest),
      status: loan.status,
      last_accrual_date: ctx.now,
      next_accrual_date: batch.nextAccrualDate,
      maturity_date: loan.maturity_date,
    };
  }

  const deltaPrincipal = round2(after.principal_outstanding - before.principal_outstanding);
  const deltaInterest = round2(after.interest_balance - before.interest_balance);
  return { skip: false, mode, before, after, deltaPrincipal, deltaInterest, warnings };
}

/**
 * Ledger rows that move the receivable accounts to the recalculated balances.
 * Principal/interest receivable follow the balance change; the difference in
 * the total owed is interest revenue (a pure principal<->interest shift nets
 * to zero revenue). Always balanced: debits equal credits.
 */
export function conversionLedgerRows(loanId, deltaPrincipal, deltaInterest) {
  const rows = [];
  const push = (account, amount) => {
    if (Math.abs(amount) < 0.005) return;
    rows.push({ loan_id: loanId, account, type: amount > 0 ? 'debit' : 'credit', amount: round2(Math.abs(amount)) });
  };
  push('loan_receivable_principal', deltaPrincipal);
  push('loan_receivable_interest', deltaInterest);
  push('interest_revenue', -(deltaPrincipal + deltaInterest));
  return rows;
}
