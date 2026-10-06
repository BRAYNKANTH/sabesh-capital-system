import db from '../db.js';
import { sendNotification } from './notification.js';
import { PAWN_GRACE_DAYS } from './pawnMath.js';

async function getOrgName() {
  try {
    const settings = await db('org_settings').first();
    return settings?.org_name || 'Your Lender';
  } catch {
    return 'Your Lender';
  }
}

const money = (n) => `LKR ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' });
const itemLabel = (loan) => (loan.pawn_type === 'gold' ? 'gold jewellery' : 'vehicle');

function toCustomer(loan, message) {
  return sendNotification({ recipientName: loan.customer_name, phone: loan.mobile, message, role: 'borrower' });
}

export async function notifyPawnCreated(loan) {
  const org = await getOrgName();
  await toCustomer(loan, `Dear ${loan.customer_name}, your pawn loan ${loan.reference_number} of ${money(loan.principal_amount)} against your ${itemLabel(loan)} has been recorded. Interest: ${Number(loan.interest_rate)}% per month. Due date: ${dateText(loan.due_date)}. Thank you, ${org}`);
}

export async function notifyPawnPayment(loan, { amount, paymentType, redeemed }) {
  const org = await getOrgName();
  const kind = paymentType === 'interest' ? 'interest' : 'principal';
  const tail = redeemed
    ? ` Your loan is now fully paid — please collect your ${itemLabel(loan)}.`
    : ` Remaining principal: ${money(loan.principal_outstanding)}. Remaining interest due: ${money(loan.interest_balance)}.`;
  await toCustomer(loan, `Dear ${loan.customer_name}, we received ${money(amount)} (${kind}) for pawn loan ${loan.reference_number}.${tail} Thank you, ${org}`);
}

export async function notifyPawnExtended(loan, { additionalMonths }) {
  const org = await getOrgName();
  await toCustomer(loan, `Dear ${loan.customer_name}, the due date of your pawn loan ${loan.reference_number} has been extended by ${additionalMonths} month${additionalMonths === 1 ? '' : 's'}. New due date: ${dateText(loan.due_date)}. Interest continues at ${Number(loan.interest_rate)}% per month. Thank you, ${org}`);
}

export async function notifyPawnForfeited(loan) {
  const org = await getOrgName();
  await toCustomer(loan, `Dear ${loan.customer_name}, as pawn loan ${loan.reference_number} was not paid within the agreed period, the pledged ${itemLabel(loan)} has been forfeited under the loan terms. Please contact us. ${org}`);
}

export async function notifyPawnReminder(loan, { kind, daysUntilDue, daysOverdue }) {
  const org = await getOrgName();
  const owed = `Interest due: ${money(loan.interest_balance)}. Principal: ${money(loan.principal_outstanding)}.`;
  let body;
  if (kind === 'soon') {
    body = `your pawn loan ${loan.reference_number} is due ${daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`} (${dateText(loan.due_date)}). ${owed}`;
  } else if (kind === 'today') {
    body = `your pawn loan ${loan.reference_number} is due today. ${owed}`;
  } else {
    const daysLeft = Math.max(0, PAWN_GRACE_DAYS + 1 - daysOverdue);
    body = `your pawn loan ${loan.reference_number} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue. ${owed} Your pledged ${itemLabel(loan)} may be forfeited in ${daysLeft} day${daysLeft === 1 ? '' : 's'} if unpaid. Please pay or contact us.`;
  }
  await toCustomer(loan, `Dear ${loan.customer_name}, ${body} ${org}`);
}
