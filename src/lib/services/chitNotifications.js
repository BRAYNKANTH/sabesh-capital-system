import db from '../db.js';
import { sendNotification } from './notification.js';

async function getOrgName() {
  try {
    const settings = await db('org_settings').first();
    return settings?.org_name || 'Your Host';
  } catch {
    return 'Your Host';
  }
}

const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' });

// Thank-you SMS to a chit member the moment their payment for a round is
// ticked as paid. Safe to fire and forget: the caller logs any failure, and
// every attempt is also recorded in the SMS Log by sendNotification.
export async function notifyChitPaymentReceived(paymentId) {
  const payment = await db('ticket_payments')
    .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
    .join('tickets', 'ticket_payments.ticket_id', 'tickets.id')
    .join('ticket_auctions', 'ticket_payments.auction_id', 'ticket_auctions.id')
    .where('ticket_payments.id', paymentId)
    .select(
      'ticket_payments.member_id', 'ticket_payments.ticket_id', 'ticket_payments.round_number', 'ticket_payments.payment_date',
      'ticket_members.name as member_name', 'ticket_members.phone as member_phone',
      'tickets.name as group_name', 'tickets.next_round_date',
      'ticket_auctions.amount_per_member'
    )
    .first();
  if (!payment || !payment.member_phone) return { sent: false, reason: 'no_phone' };

  const [{ count: paidCount }] = await db('ticket_payments').where({ ticket_id: payment.ticket_id, member_id: payment.member_id, is_paid: true }).count('id as count');
  const [{ count: roundsRun }] = await db('ticket_auctions').where({ ticket_id: payment.ticket_id }).count('id as count');
  const org = await getOrgName();

  const nextRound = payment.next_round_date ? ` Next round: ${dateText(payment.next_round_date)}.` : '';
  const message = `Dear ${payment.member_name}, we received your payment of ${money(payment.amount_per_member)} for ${payment.group_name} (Round ${payment.round_number}) on ${dateText(payment.payment_date || new Date())}. Thank you! Rounds paid so far: ${paidCount} of ${roundsRun}.${nextRound} ${org}`;

  await sendNotification({ recipientName: payment.member_name, phone: payment.member_phone, message, role: 'chit member' });
  return { sent: true };
}
