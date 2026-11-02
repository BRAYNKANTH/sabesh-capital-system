import db from '../db.js';
import { calculateInterestPerPeriod, computeAccrualBatch } from './loanMath.js';
import { logError } from '../logger.js';

/**
 * Accrues interest for all active loans whose next_accrual_date is in the past.
 * Executed in a transaction for each loan to ensure integrity.
 *
 * Called from the Vercel Cron route (app/api/cron/accrue-interest) instead of
 * a setInterval loop — serverless functions don't stay alive between requests.
 *
 * Pass `loanId` to scope this to a single loan instead of sweeping every
 * active loan in the system — used when a loan's detail page wants an
 * up-to-date balance without paying the cost of processing every OTHER
 * loan too. Without it, this was running a full system-wide accrual sweep
 * on every single loan detail page view, getting more expensive as the
 * loan book grows regardless of which one loan was actually being looked at.
 */
export async function runInterestAccruals(loanId) {
  console.log(loanId ? `Running interest accrual check for loan ${loanId}...` : 'Running interest accrual checks...');
  let query = db('loans')
    .where('status', 'active')
    .andWhere('next_accrual_date', '<=', db.fn.now())
    // Flat installment loans (Daily + Fixed Term) have their full interest
    // total set upfront at creation/approval — see recordFlatInstallmentCollection
    // in ledger.js — not accrued incrementally like every other loan type.
    .andWhere('is_flat_installment', false)
    // Cheque loans carry their whole-period interest from the day they are issued.
    .andWhereNot('collection_mode', 'cheque');
  if (loanId) query = query.andWhere('id', loanId);
  const activeLoans = await query;

  console.log(`Found ${activeLoans.length} loans qualifying for interest accrual.`);

  const results = [];

  for (const loan of activeLoans) {
    try {
      const result = await db.transaction(async (trx) => {
        // Lock row
        const dbLoan = await trx('loans').where({ id: loan.id }).first().forUpdate();

        // Re-verify conditions
        if (dbLoan.status !== 'active' || new Date(dbLoan.next_accrual_date) > new Date()) {
          return { loanId: loan.id, status: 'skipped' };
        }

        // Catch up on every missed period in one pass, not just one. Cron
        // only fires once — if it doesn't run for a few days (a Vercel
        // outage, a bug, etc.), a single-period accrual would otherwise take
        // that many additional daily cron runs to fully catch up, silently
        // under-accruing interest in the meantime. Capped at 500 periods as
        // a sanity ceiling against a corrupted next_accrual_date.
        //
        // The actual math (interestPerPeriod, the period-stepping loop) is
        // extracted into loanMath.js as pure functions — unit tested there
        // without needing a database. This block just persists the result.
        const principal = parseFloat(dbLoan.principal_amount);
        const rate = parseFloat(dbLoan.interest_rate);
        const interestPerPeriod = calculateInterestPerPeriod(principal, rate, dbLoan.interest_type);

        const batch = computeAccrualBatch({
          interestType: dbLoan.interest_type,
          interestPerPeriod,
          startingInterestBalance: parseFloat(dbLoan.interest_balance),
          nextAccrualDate: dbLoan.next_accrual_date,
          now: new Date(),
          maturityDate: dbLoan.maturity_date,
        });

        if (batch.periods.length === 0) {
          return { loanId: loan.id, status: 'skipped' };
        }

        for (const period of batch.periods) {
          const logText = dbLoan.interest_type === 'daily'
            ? `Principal: ${principal} | Monthly Rate: ${rate}% | Daily Accrual (Monthly/30): LKR ${period.amount.toFixed(2)} | Date: ${period.date.toISOString().slice(0, 10)}`
            : `Principal: ${principal} | Rate: ${rate}% | Type: ${dbLoan.interest_type} | Accrual period for ${period.date.toISOString().slice(0, 10)}`;
          await trx('interest_accruals').insert({
            loan_id: dbLoan.id,
            amount_accrued: period.amount,
            calculation_log: logText
          });
        }

        const periodsAccrued = batch.periods.length;
        const totalAccrued = batch.totalAccrued;
        const runningInterestBalance = batch.runningInterestBalance;
        const nextDate = batch.nextAccrualDate;

        // Post Ledger Entries (Double-Entry Ledger) — one combined posting
        // for the whole catch-up batch.
        // A: Debit loan_receivable_interest (Asset increases)
        // B: Credit interest_revenue (Revenue increases)
        await trx('ledger_entries').insert([
          {
            loan_id: dbLoan.id,
            account: 'loan_receivable_interest',
            type: 'debit',
            amount: totalAccrued
          },
          {
            loan_id: dbLoan.id,
            account: 'interest_revenue',
            type: 'credit',
            amount: totalAccrued
          }
        ]);

        // Update Loan Row
        await trx('loans')
          .where({ id: dbLoan.id })
          .update({
            interest_balance: runningInterestBalance,
            last_accrual_date: db.fn.now(),
            next_accrual_date: nextDate,
            updated_at: db.fn.now()
          });

        // Create Audit Log
        await trx('audit_logs').insert({
          actor_id: dbLoan.lender_id, // Assigned to Lender Admin
          action_type: 'ACCRUE_INTEREST',
          description: periodsAccrued > 1
            ? `Accrued interest for ${periodsAccrued} missed periods (LKR ${totalAccrued.toLocaleString()} total) on loan of LKR ${principal.toLocaleString()} for Borrower. Outstanding interest due: LKR ${runningInterestBalance.toLocaleString()}.`
            : `Accrued interest of LKR ${totalAccrued.toLocaleString()} on loan of LKR ${principal.toLocaleString()} for Borrower. Outstanding interest due: LKR ${runningInterestBalance.toLocaleString()}.`
        });

        return { loanId: dbLoan.id, accruedAmount: totalAccrued, periodsAccrued, status: 'accrued' };
      });
      results.push(result);
    } catch (err) {
      logError('Error accruing interest', err, { loanId: loan.id });
      results.push({ loanId: loan.id, error: err.message, status: 'error' });
    }
  }

  return results;
}
