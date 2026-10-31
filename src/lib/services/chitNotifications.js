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

// The group's short code, when it has one (the codes migration may not have been run yet).
async function groupCodes(ticketIds) {
  try {
    const rows = await db('tickets').whereIn('id', ticketIds).select('id', 'code');
    return new Map(rows.map((r) => [r.id, r.code]));
  } catch {
    return new Map();
  }
}
const groupLabel = (name, code) => (code ? `${name} [${code}]` : name);

const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' });

// Thank-you SMS to a chit member each time money is collected for a round.
// `received` is what came in just now and `balance` what is still owed after
// it; a payment that is not yet fully covered says so. Safe to fire and forget:
// the caller logs any failure, and every attempt is also recorded in the SMS
// Log by sendNotification.
export async function notifyChitPaymentReceived(paymentId, { received, balance } = {}) {
  const payment = await db('ticket_payments')
    .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
    .join('tickets', 'ticket_payments.ticket_id', 'tickets.id')
    .leftJoin('ticket_auctions', 'ticket_payments.auction_id', 'ticket_auctions.id')
    .where('ticket_payments.id', paymentId)
    .select(
      'ticket_payments.member_id', 'ticket_payments.ticket_id', 'ticket_payments.round_number', 'ticket_payments.payment_date', 'ticket_payments.amount',
      'ticket_members.name as member_name', 'ticket_members.phone as member_phone',
      'tickets.name as group_name', 'tickets.next_round_date',
      'ticket_auctions.amount_per_member'
    )
    .first();
  if (!payment || !payment.member_phone) return { sent: false, reason: 'no_phone' };

  const [{ count: paidCount }] = await db('ticket_payments').where({ ticket_id: payment.ticket_id, member_id: payment.member_id, is_paid: true }).count('id as count');
  const [{ count: roundsRun }] = await db('ticket_auctions').where({ ticket_id: payment.ticket_id }).count('id as count');
  const org = await getOrgName();
  const groupText = groupLabel(payment.group_name, (await groupCodes([payment.ticket_id])).get(payment.ticket_id));

  const nextRound = payment.next_round_date ? ` Next round: ${dateText(payment.next_round_date)}.` : '';
  const when = dateText(payment.payment_date || new Date());
  const got = money(received ?? payment.amount ?? payment.amount_per_member);
  // Taken before the round's auction: there is no amount due yet, so no balance
  // or "rounds paid" figure to quote.
  const beforeAuction = payment.amount_per_member === null || payment.amount_per_member === undefined;
  const message = balance > 0
    ? `Dear ${payment.member_name}, we received ${got} for ${groupText} (Round ${payment.round_number}) on ${when}. Balance still to pay: ${money(balance)}. Thank you! ${org}`
    : beforeAuction
    ? `Dear ${payment.member_name}, we received ${got} for ${groupText} (Round ${payment.round_number}) on ${when}. Thank you! ${org}`
    : `Dear ${payment.member_name}, we received your payment of ${got} for ${groupText} (Round ${payment.round_number}) on ${when}. Thank you! Rounds paid so far: ${paidCount} of ${roundsRun}.${nextRound} ${org}`;

  const result = await sendNotification({ recipientName: payment.member_name, phone: payment.member_phone, message, role: 'chit member' });
  // success = the SMS provider accepted it; mocked = Text.lk isn't configured, so nothing left the server.
  return { sent: !!result.success && !result.mocked, mocked: !!result.mocked, failed: !result.success };
}

// One thank-you SMS for a customer who paid several chits in one visit: each
// chit's amount is listed separately, with the combined total.
// `received` maps payment id -> what came in for it just now (a chit that had
// part-paid earlier is collected for its remaining balance only).
export async function notifyChitCombinedPaymentReceived(paymentIds, received = {}) {
  const rows = await db('ticket_payments')
    .join('ticket_members', 'ticket_payments.member_id', 'ticket_members.id')
    .join('tickets', 'ticket_payments.ticket_id', 'tickets.id')
    .whereIn('ticket_payments.id', paymentIds)
    .select('ticket_payments.id', 'ticket_payments.ticket_id', 'ticket_payments.round_number', 'ticket_payments.amount', 'ticket_payments.payment_date',
      'ticket_members.name as member_name', 'ticket_members.phone as member_phone', 'tickets.name as group_name')
    .orderBy('tickets.name', 'asc');
  const phone = rows.map((r) => r.member_phone).find(Boolean);
  if (!rows.length || !phone) return { sent: false, reason: 'no_phone' };

  const org = await getOrgName();
  const codes = await groupCodes([...new Set(rows.map((r) => r.ticket_id))]);
  const got = (r) => parseFloat(received[r.id] ?? r.amount) || 0;
  const total = rows.reduce((s, r) => s + got(r), 0);
  const parts = rows.map((r) => `${money(got(r))} for ${groupLabel(r.group_name, codes.get(r.ticket_id))} (Round ${r.round_number})`).join(', ');
  const message = `Dear ${rows[0].member_name}, we received your payments on ${dateText(rows[0].payment_date || new Date())}: ${parts}. Total ${money(total)}. Thank you! ${org}`;

  const result = await sendNotification({ recipientName: rows[0].member_name, phone, message, role: 'chit member' });
  return { sent: !!result.success && !result.mocked, mocked: !!result.mocked, failed: !result.success };
}
