import fs from 'fs';
import path from 'path';
import { sendSms } from './sms.js';
import db from '../db.js';

const logFilePath = path.join(process.cwd(), 'notifications_log.txt');

// This organization's own display name, read from its own database (see
// org_settings in scripts/migrate.js) instead of a hardcoded "STN CREDIT" —
// used for the SMS sign-off. Falls back to a generic label if the lookup
// fails for any reason, so a DB hiccup never breaks payment notifications.
async function getOrgName() {
  try {
    const settings = await db('org_settings').first();
    return settings?.org_name || 'Your Lender';
  } catch {
    return 'Your Lender';
  }
}

/**
 * Dispatches a notification to a specific phone number/user via Text.lk SMS
 * (falls back to a console-only mock when TEXTLK_API_TOKEN isn't set — see
 * sms.js). Also logs to console and, in local dev only, appends to a text
 * file for quick inspection — Vercel's filesystem is read-only outside
 * /tmp, so file logging is skipped in production.
 */
export async function sendNotification({ recipientName, phone, message, role }) {
  const timestamp = new Date().toLocaleString();
  const logMessage = `[${timestamp}] TO: ${recipientName} (${phone}) [Role: ${role}]\nMSG: "${message}"\n---------------------------------------------\n`;

  console.log('\n======================================================');
  console.log(`🔔 NOTIFICATION DISPATCHED [Channel: SMS]`);
  console.log(`To: ${recipientName} (${phone})`);
  console.log(`Message: ${message}`);
  console.log('======================================================\n');

  if (process.env.NODE_ENV !== 'production') {
    try {
      fs.appendFileSync(logFilePath, logMessage);
    } catch (err) {
      console.error('Failed to write notification to log file:', err);
    }
  }

  const smsResult = await sendSms({ to: phone, message });

  // Persist every attempt — see the sms_logs migration comment for why:
  // this is the only place that would otherwise show whether an SMS
  // genuinely left the server or silently no-op'd because Text.lk isn't
  // configured for this org. Best-effort: a logging failure must never
  // take down the notification flow that triggered it.
  try {
    await db('sms_logs').insert({
      recipient_name: recipientName || null,
      phone,
      role: role || null,
      status: !smsResult.success ? 'failed' : smsResult.mocked ? 'mocked' : 'sent',
      message,
      error: smsResult.error || (smsResult.reason ? `reason: ${smsResult.reason}` : null)
    });
  } catch (err) {
    console.error('Failed to write sms_logs entry:', err);
  }

  return { success: smsResult.success, mocked: smsResult.mocked, timestamp };
}

/**
 * Sends a one-time verification code to a user who requested a self-service
 * password reset. Deliberately just the code, not a usable password — the
 * user still has to choose their own new password in the same step that
 * verifies this OTP (see /api/auth/reset-password), so a leaked SMS alone
 * can't grant account access.
 */
export async function notifyPasswordResetOtp({ user, otp }) {
  await sendNotification({
    recipientName: user.name,
    phone: user.phone,
    message: `Your password reset code is: ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this message.`,
    role: user.role
  });
}

/**
 * Triggers alerts for loan creation.
 */
export async function notifyLoanCreation({ borrower, principal, interestType, rate, isFlatInstallment, dailyInstallmentAmount, durationPeriods }) {
  let borrowerMsg;
  if (isFlatInstallment) {
    // Flat Daily Installment loans (Daily + Fixed Term) collect a fixed
    // principal+interest bundle each day, starting today, for the full
    // entered duration — not a plain per-period interest figure.
    const totalRepayable = Number(dailyInstallmentAmount) * Number(durationPeriods);
    borrowerMsg = `Dear ${borrower.name}, you have successfully got a loan of Rs. ${Number(principal).toLocaleString()}. Your daily installment (principal + interest) is Rs. ${Number(dailyInstallmentAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, payable every day for ${durationPeriods} days starting today. Total repayable: Rs. ${totalRepayable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  } else {
    const monthlyInterest = Number(principal) * (Number(rate) / 100);
    let calculatedInterest = monthlyInterest;
    if (interestType === 'daily') {
      calculatedInterest = monthlyInterest / 30;
    } else if (interestType === 'weekly') {
      calculatedInterest = monthlyInterest / 4;
    }

    const frequencyText = interestType.toLowerCase(); // 'daily', 'weekly', 'monthly'
    borrowerMsg = `Dear ${borrower.name}, you have successfully got a loan of Rs. ${Number(principal).toLocaleString()} at monthly rate ${rate}%. Your ${frequencyText} collection amount is Rs. ${calculatedInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  }

  await sendNotification({
    recipientName: borrower.name,
    phone: borrower.phone,
    message: borrowerMsg,
    role: 'borrower'
  });
}

/**
 * Alerts an admin that an agent submitted a loan application awaiting
 * approval — nothing has actually disbursed yet.
 */
export async function notifyLoanPendingApproval({ admin, borrower, principal, submittedByName }) {
  await sendNotification({
    recipientName: admin.name,
    phone: admin.phone,
    message: `New loan application awaiting your approval: LKR ${Number(principal).toLocaleString()} for ${borrower.name}, submitted by ${submittedByName}. Review and approve/reject in the app.`,
    role: 'admin'
  });
}

/**
 * Alerts the borrower (loan now real) and the submitting agent when an
 * admin approves a pending loan application.
 */
export async function notifyLoanApplicationApproved({ borrower, principal, interestType, rate, submittedBy, isFlatInstallment, dailyInstallmentAmount, durationPeriods }) {
  await notifyLoanCreation({ borrower, principal, interestType, rate, isFlatInstallment, dailyInstallmentAmount, durationPeriods });

  if (submittedBy) {
    await sendNotification({
      recipientName: submittedBy.name,
      phone: submittedBy.phone,
      message: `Your loan application for ${borrower.name} (LKR ${Number(principal).toLocaleString()}) has been approved and disbursed.`,
      role: submittedBy.role
    });
  }
}

/**
 * Alerts the submitting agent when an admin rejects their loan
 * application. The borrower isn't SMS'd directly — the agent who met them
 * in person is better placed to explain why.
 */
export async function notifyLoanApplicationRejected({ submittedBy, borrowerName, principal, reason }) {
  if (!submittedBy) return;
  await sendNotification({
    recipientName: submittedBy.name,
    phone: submittedBy.phone,
    message: `Your loan application for ${borrowerName} (LKR ${Number(principal).toLocaleString()}) was rejected. Reason: ${reason}`,
    role: submittedBy.role
  });
}

/**
 * Triggers alerts for collections. paymentType distinguishes an interest
 * payment (recurring, doesn't close the loan) from a principal payment
 * (reduces the fixed loan amount, closes the loan at zero).
 */
export async function notifyPaymentReceived({ borrower, admin, agent, amount, paymentType, principalOutstanding, interestBalance, interestType }) {
  const formattedAmount = Number(amount).toLocaleString();
  const kind = paymentType === 'interest' ? 'interest' : paymentType === 'flat_installment' ? 'daily installment' : 'principal';

  // RULE: Exclude daily collection payments from SMS notifications entirely
  // — for both the borrower and the admin. Daily collections happen every
  // single day on every active daily loan, so an SMS per collection (to
  // either side) is just noise at that volume; only send for weekly &
  // monthly collections, which are infrequent enough to be worth alerting on.
  if (interestType !== 'daily') {
    const orgName = await getOrgName();
    const borrowerMsg = `Dear ${borrower.name},

You have successfully paid LKR ${formattedAmount} (${kind}) for your loan.

Receipt Details:
- Amount Paid: LKR ${formattedAmount}
- Payment Type: ${kind === 'interest' ? 'Interest' : 'Principal'}
- Remaining Principal: LKR ${Number(principalOutstanding).toLocaleString()}
- Remaining Interest Due: LKR ${Number(interestBalance).toLocaleString()}

Thank you,
${orgName}`;

    await sendNotification({
      recipientName: borrower.name,
      phone: borrower.phone,
      message: borrowerMsg,
      role: 'borrower'
    });

    if (admin) {
      const agentName = agent ? agent.name : 'Unknown';
      const adminMsg = `${orgName} Alert: Collection of LKR ${formattedAmount} (${kind}) from ${borrower.name} recorded by Agent ${agentName}. Remaining Principal: LKR ${Number(principalOutstanding).toLocaleString()}, Remaining Interest: LKR ${Number(interestBalance).toLocaleString()}.`;
      await sendNotification({
        recipientName: admin.name,
        phone: admin.phone,
        message: adminMsg,
        role: 'admin'
      });
    }
  } else {
    console.log(`Skipped SMS receipt (borrower + admin) for Daily collection loan (${borrower.name}).`);
  }
}

/**
 * Reminder for an active (non-daily) loan's upcoming interest payment,
 * sent proactively before the due date rather than after — see
 * runPaymentReminders in reminders.js for the timing logic.
 */
export async function notifyPaymentReminder({ borrower, interestBalance, interestType, daysUntilDue }) {
  const dueText = daysUntilDue === 0
    ? 'is due today'
    : daysUntilDue === 1
      ? 'is due tomorrow'
      : `is due in ${daysUntilDue} days`;
  await sendNotification({
    recipientName: borrower.name,
    phone: borrower.phone,
    message: `Reminder: your ${interestType} interest payment of LKR ${Number(interestBalance).toLocaleString()} ${dueText}. Please arrange payment with your collection agent.`,
    role: 'borrower'
  });
}

/**
 * Alerts the admin (and optionally the borrower) when a day is marked
 * 'not_paid' on the daily collection tracker.
 */
export async function notifyMissedPayment({ borrower, admin, collectionDate }) {
  const dateStr = new Date(collectionDate).toLocaleDateString();

  if (admin) {
    await sendNotification({
      recipientName: admin.name,
      phone: admin.phone,
      message: `Missed collection: ${borrower.name} did not pay on ${dateStr}.`,
      role: 'admin'
    });
  }
}

/**
 * Alerts the borrower, assigned agent, and admin when a flat-installment
 * (daily collection) loan has gone missedDays or more calendar days without
 * its expected installment being collected — see runMissedDailyCollectionAlerts
 * in reminders.js. All three get a message every time this fires (it
 * repeats daily while the loan stays behind, by design), each phrased for
 * their role.
 */
export async function notifyMissedDailyCollection({ borrower, agent, admin, missedDays, missedAmount, dailyInstallmentAmount }) {
  const amountStr = `LKR ${Number(missedAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const dailyStr = `LKR ${Number(dailyInstallmentAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  await sendNotification({
    recipientName: borrower.name,
    phone: borrower.phone,
    message: `Your daily installment of ${dailyStr} has not been collected for ${missedDays} day(s) (${amountStr} behind). Please arrange payment with your collection agent as soon as possible.`,
    role: 'borrower'
  });

  if (agent) {
    await sendNotification({
      recipientName: agent.name,
      phone: agent.phone,
      message: `Collection alert: ${borrower.name}'s daily installment has been missed for ${missedDays} day(s) (${amountStr} behind schedule). Please follow up.`,
      role: agent.role
    });
  }

  if (admin) {
    await sendNotification({
      recipientName: admin.name,
      phone: admin.phone,
      message: `Collection alert: ${borrower.name}'s daily loan is ${missedDays} day(s) behind (${amountStr} uncollected)${agent ? `, assigned to ${agent.name}` : ''}.`,
      role: 'admin'
    });
  }
}

/**
 * Alerts when a loan is marked as defaulted.
 */
export async function notifyLoanDefaulted({ borrower, admin, reason, principalOutstanding }) {
  const msg = `Your loan has been marked as defaulted. Outstanding principal: LKR ${Number(principalOutstanding).toLocaleString()}. Please contact us immediately.`;
  await sendNotification({ recipientName: borrower.name, phone: borrower.phone, message: msg, role: 'borrower' });

  if (admin) {
    await sendNotification({
      recipientName: admin.name,
      phone: admin.phone,
      message: `Loan for ${borrower.name} marked defaulted. Reason: ${reason}. Outstanding principal: LKR ${Number(principalOutstanding).toLocaleString()}.`,
      role: 'admin'
    });
  }
}

/**
 * Alerts the borrower when a defaulted loan is reinstated back to active.
 */
export async function notifyLoanReinstated({ borrower, admin }) {
  await sendNotification({
    recipientName: borrower.name,
    phone: borrower.phone,
    message: `Your loan has been reinstated to active status. Please resume payments with your collection agent.`,
    role: 'borrower'
  });

  if (admin) {
    await sendNotification({
      recipientName: admin.name,
      phone: admin.phone,
      message: `Loan for ${borrower.name} has been reinstated from defaulted to active.`,
      role: 'admin'
    });
  }
}

/**
 * Alerts the borrower when their fixed-term loan is restructured to run
 * longer — extend-term only, so the message is careful to say the payment
 * amount itself hasn't changed (only how much more time they have).
 */
export async function notifyLoanTermExtended({ borrower, extendBy, periodUnit, newMaturityDate, installmentAmount }) {
  const unitLabel = `${periodUnit}${extendBy === 1 ? '' : 's'}`;
  const maturityStr = new Date(newMaturityDate).toLocaleDateString();
  const amountClause = installmentAmount
    ? ` Your ${periodUnit === 'day' ? 'daily' : periodUnit === 'week' ? 'weekly' : 'monthly'} payment amount of Rs. ${Number(installmentAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is unchanged.`
    : ' Your payment amount is unchanged.';
  await sendNotification({
    recipientName: borrower.name,
    phone: borrower.phone,
    message: `Your loan term has been extended by ${extendBy} ${unitLabel}. New end date: ${maturityStr}.${amountClause} Please continue payments with your collection agent.`,
    role: 'borrower'
  });
}

/**
 * Alerts the borrower when a penalty/late fee is added to their loan.
 */
export async function notifyPenaltyApplied({ borrower, admin, amount, reason, newInterestBalance }) {
  await sendNotification({
    recipientName: borrower.name,
    phone: borrower.phone,
    message: `A penalty of LKR ${Number(amount).toLocaleString()} has been added to your loan${reason ? ` (${reason})` : ''}. Total interest/fees due: LKR ${Number(newInterestBalance).toLocaleString()}.`,
    role: 'borrower'
  });

  if (admin) {
    await sendNotification({
      recipientName: admin.name,
      phone: admin.phone,
      message: `Penalty of LKR ${Number(amount).toLocaleString()} applied to ${borrower.name}'s loan${reason ? ` (${reason})` : ''}.`,
      role: 'admin'
    });
  }
}
