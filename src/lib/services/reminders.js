import db from '../db.js';
import { notifyPaymentReminder, notifyMissedDailyCollection, notifyChequeDue } from './notification.js';
import { getSriLankaTodayRange } from '../loanSchedule.js';
import { logError } from '../logger.js';

/**
 * Sends a proactive reminder to borrowers on weekly/monthly (non-daily,
 * non-flat-installment) loans a configurable number of days BEFORE their
 * next interest payment is due — not after, which is how this used to
 * work. Run once daily via Vercel Cron — see app/api/cron/payment-reminders.
 *
 * Timing: org_settings.overdue_reminder_threshold_days now means "how many
 * days before next_accrual_date to remind", matching the admin-facing
 * "Overdue Reminder Threshold" setting's new meaning. Firing on an EXACT
 * day match (daysUntilDue === thresholdDays) rather than "<=" is what keeps
 * this to one SMS per loan per cycle — the day count only equals the
 * threshold on one specific calendar day, so the next day's cron run no
 * longer matches and won't re-send.
 *
 * Daily/flat-installment loans are excluded entirely — see
 * runMissedDailyCollectionAlerts below, which replaces this for them with
 * a fundamentally different (miss-detection, not due-date) check.
 *
 * Loans already past their due date with nothing paid are NOT covered here
 * — this is a before-the-fact nudge, not a collections follow-up. If
 * severely overdue monthly loans also need repeated automated nagging,
 * that's a separate feature to build on top of this, not implied by it.
 */
export async function runPaymentReminders() {
  console.log('Running payment reminder checks...');

  const orgSettings = await db('org_settings').first();
  const thresholdDays = orgSettings?.overdue_reminder_threshold_days ?? 1;

  const loans = await db('loans')
    .join('users as borrowers', 'loans.borrower_id', 'borrowers.id')
    .where('loans.status', 'active')
    .andWhere('loans.interest_balance', '>', 0)
    .andWhere('loans.is_flat_installment', false)
    .andWhereNot('loans.collection_mode', 'cheque')
    .andWhereNot('loans.interest_type', 'daily')
    .whereNotNull('loans.next_accrual_date')
    .select(
      'loans.id',
      'loans.interest_balance',
      'loans.interest_type',
      'loans.next_accrual_date',
      'borrowers.name as borrower_name',
      'borrowers.phone as borrower_phone'
    );

  console.log(`Found ${loans.length} active non-daily loans to check for upcoming due dates.`);

  const today = getSriLankaTodayRange().start;

  const results = [];
  for (const loan of loans) {
    const dueDate = new Date(loan.next_accrual_date);
    dueDate.setHours(0, 0, 0, 0);
    const daysUntilDue = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));

    if (daysUntilDue !== thresholdDays) {
      results.push({ loanId: loan.id, status: 'skipped', daysUntilDue, thresholdDays });
      continue;
    }

    try {
      await notifyPaymentReminder({
        borrower: { name: loan.borrower_name, phone: loan.borrower_phone },
        interestBalance: loan.interest_balance,
        interestType: loan.interest_type,
        daysUntilDue
      });
      results.push({ loanId: loan.id, status: 'sent', daysUntilDue });
    } catch (err) {
      logError('Error sending payment reminder', err, { loanId: loan.id });
      results.push({ loanId: loan.id, status: 'error', error: err.message });
    }
  }

  return results;
}

/**
 * Texts every active admin when a cheque loan's cheque date is 2 days away (or
 * closer, if that day's run was missed). Sent once per loan: cheque_reminder_sent_at
 * is stamped after the send so the next daily run skips it. Loans that are
 * already paid off, or whose cheque date has passed, are not reminded.
 */
export const CHEQUE_REMINDER_DAYS = 2;

export async function runChequeReminders() {
  console.log('Running cheque reminder checks...');
  const loans = await db('loans')
    .join('users as borrowers', 'loans.borrower_id', 'borrowers.id')
    .where('loans.collection_mode', 'cheque')
    .andWhere('loans.status', 'active')
    .whereNull('loans.cheque_reminder_sent_at')
    .whereNotNull('loans.maturity_date')
    .select('loans.id', 'loans.cheque_number', 'loans.cheque_bank', 'loans.maturity_date',
      'loans.principal_outstanding', 'loans.interest_balance', 'borrowers.name as borrower_name', 'borrowers.phone as borrower_phone');
  if (!loans.length) return [];

  const admins = await db('users').where({ role: 'admin', is_active: true }).select('name', 'phone');
  const dayOf = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
  const todayStr = dayOf(new Date());
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

  const results = [];
  for (const loan of loans) {
    const chequeDay = dayOf(loan.maturity_date);
    const daysUntil = daysBetween(todayStr, chequeDay);
    if (daysUntil > CHEQUE_REMINDER_DAYS || daysUntil < 0) {
      results.push({ loanId: loan.id, status: 'skipped', daysUntil });
      continue;
    }
    try {
      for (const admin of admins) {
        if (!admin.phone) continue;
        await notifyChequeDue({
          admin,
          borrowerName: loan.borrower_name,
          chequeNumber: loan.cheque_number,
          chequeBank: loan.cheque_bank,
          chequeDate: chequeDay,
          amountDue: (parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0),
          daysUntil
        });
      }
      await db('loans').where({ id: loan.id }).update({ cheque_reminder_sent_at: db.fn.now() });
      results.push({ loanId: loan.id, status: 'sent', daysUntil });
    } catch (err) {
      logError('Error sending cheque reminder', err, { loanId: loan.id });
      results.push({ loanId: loan.id, status: 'error', error: err.message });
    }
  }
  return results;
}

/**
 * Alerts the borrower, assigned agent, and admin when a flat-installment
 * (daily collection) loan has gone MISSED_DAYS_THRESHOLD or more calendar
 * days without its expected daily installment actually being collected.
 * Run once daily via Vercel Cron alongside runPaymentReminders — see
 * app/api/cron/payment-reminders.
 *
 * "Missed days" is computed the same way the Record Payment screen's "Due"
 * figure is (see flatInstallmentDueToday in LendApp.jsx): what should have
 * been collected by today (elapsed days since disbursement × the daily
 * rate) minus what's actually been collected so far, expressed in whole
 * missed days rather than a raw LKR shortfall.
 *
 * Deliberately repeats every day the loan stays 3+ days behind (not just
 * once) — an unresolved daily-collection miss is actively getting worse
 * each day it's ignored, so this keeps nudging borrower/agent/admin until
 * a payment actually lands and pulls it back under the threshold.
 */
const MISSED_DAYS_THRESHOLD = 3;

export async function runMissedDailyCollectionAlerts() {
  console.log('Running missed daily-collection checks...');

  const loans = await db('loans')
    .where('status', 'active')
    .andWhere('is_flat_installment', true)
    .select(
      'id', 'borrower_id', 'assigned_agent_id', 'lender_id',
      'daily_installment_amount', 'duration_periods', 'created_at',
      'principal_amount', 'principal_outstanding', 'interest_balance'
    );

  console.log(`Found ${loans.length} active flat-installment loans to check.`);

  const today = getSriLankaTodayRange().start;

  const results = [];
  for (const loan of loans) {
    const dailyAmt = parseFloat(loan.daily_installment_amount) || 0;
    if (dailyAmt <= 0) continue;

    const totalTerm = dailyAmt * (parseFloat(loan.duration_periods) || 0);
    const remaining = (parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0);
    const collectedSoFar = Math.max(0, totalTerm - remaining);

    const start = new Date(loan.created_at);
    start.setHours(0, 0, 0, 0);
    const elapsedDays = Math.min(
      Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1),
      parseFloat(loan.duration_periods) || 1
    );
    const expectedSoFar = dailyAmt * elapsedDays;
    const missedAmount = Math.max(0, Math.min(expectedSoFar - collectedSoFar, remaining));
    const missedDays = Math.floor(missedAmount / dailyAmt);

    if (missedDays < MISSED_DAYS_THRESHOLD) {
      results.push({ loanId: loan.id, status: 'skipped', missedDays });
      continue;
    }

    try {
      const borrower = await db('users').where({ id: loan.borrower_id }).first();
      const agent = loan.assigned_agent_id ? await db('users').where({ id: loan.assigned_agent_id }).first() : null;
      const admin = loan.lender_id ? await db('users').where({ id: loan.lender_id }).first() : null;
      if (!borrower) {
        results.push({ loanId: loan.id, status: 'error', error: 'borrower not found' });
        continue;
      }

      await notifyMissedDailyCollection({
        borrower, agent, admin,
        missedDays, missedAmount, dailyInstallmentAmount: dailyAmt
      });

      await db('audit_logs').insert({
        actor_id: loan.lender_id || loan.borrower_id,
        action_type: 'MISSED_DAILY_COLLECTION_ALERT',
        description: `Daily collection alert: loan ID ${loan.id} is ${missedDays} day(s) behind (LKR ${missedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} uncollected). Notified borrower${agent ? ', agent' : ''}${admin ? ', admin' : ''}.`
      });

      results.push({ loanId: loan.id, status: 'sent', missedDays, missedAmount });
    } catch (err) {
      logError('Error sending missed-collection alert', err, { loanId: loan.id });
      results.push({ loanId: loan.id, status: 'error', error: err.message });
    }
  }

  return results;
}
