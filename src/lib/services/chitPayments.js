import { postChitCollection } from './chitLedger.js';

// A member's payment for one round can come in several instalments. Every
// instalment is a row in ticket_payment_entries (a reversal is a negative row,
// so nothing is ever deleted). ticket_payments keeps the running totals:
//   amount   - the total collected so far
//   is_paid  - true only once the total reaches the round's amount due
// Before the round's auction is run the amount due is not known yet, so the
// payment stays unpaid until the auction fixes it.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A single instalment above this is a typing mistake (and would overflow the
// numeric(15,2) column).
export const MAX_INSTALMENT = 1e10;

// What is still owed, or null when the amount due is not known yet.
export function balanceDue(due, collected) {
  if (due === null || due === undefined || due === '') return null;
  return Math.max(0, round2(round2(due) - round2(collected)));
}

export function isFullyPaid(due, collected) {
  if (due === null || due === undefined || due === '') return false;
  return round2(collected) >= round2(due) && round2(due) > 0;
}

// Checks an instalment about to be recorded. Returns { amount } to record, or
// { error } with a message that can be shown as-is.
export function checkInstalment(amount, due, collected) {
  const value = round2(amount);
  if (!(value > 0)) return { error: 'Enter the amount collected.' };
  if (value > MAX_INSTALMENT) return { error: 'That amount is too large. Check it and try again.' };
  const balance = balanceDue(due, collected);
  if (balance !== null) {
    if (balance <= 0) return { error: 'This payment is already fully paid.' };
    if (value > balance) {
      const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return { error: `LKR ${fmt(value)} is more than the balance of LKR ${fmt(balance)}.` };
    }
  }
  return { amount: value };
}

// Loads one payment row with its round's amount due, locked for the rest of
// the transaction so two simultaneous collections cannot both pass the check.
export async function lockPayment(trx, paymentId, ticketId) {
  const row = await trx('ticket_payments')
    .where({ id: paymentId, ...(ticketId ? { ticket_id: ticketId } : {}) })
    .forUpdate()
    .first();
  if (!row) return null;
  const auction = row.auction_id ? await trx('ticket_auctions').where({ id: row.auction_id }).first() : null;
  return { ...row, amount_due: auction ? parseFloat(auction.amount_per_member) : null };
}

// Recomputes the payment's totals from its entries.
export async function settlePayment(trx, paymentId) {
  const row = await lockPayment(trx, paymentId);
  if (!row) return null;
  const { total } = await trx('ticket_payment_entries').where({ payment_id: paymentId }).sum('amount as total').first();
  const collected = round2(total);
  const last = collected > 0
    ? await trx('ticket_payment_entries').where({ payment_id: paymentId }).andWhere('amount', '>', 0).orderBy('created_at', 'desc').first()
    : null;
  await trx('ticket_payments').where({ id: paymentId }).update({
    amount: collected > 0 ? collected : null,
    is_paid: isFullyPaid(row.amount_due, collected),
    payment_date: last ? last.created_at : null,
    collected_by: last ? last.collected_by : null
  });
  return { ...row, amount: collected > 0 ? collected : 0 };
}

// Records one instalment and posts it to the ledger. `payment` must come from
// lockPayment in the same transaction. Returns { error } without writing when
// the amount is not acceptable.
export async function addInstalment(trx, payment, amount, userId) {
  const check = checkInstalment(amount, payment.amount_due, payment.amount);
  if (check.error) return check;
  await trx('ticket_payment_entries').insert({ payment_id: payment.id, amount: check.amount, collected_by: userId });
  await postChitCollection(trx, check.amount);
  const settled = await settlePayment(trx, payment.id);
  return { amount: check.amount, collected: settled.amount, balance: balanceDue(payment.amount_due, settled.amount) };
}

// Takes back everything collected on this payment: a negative entry per
// collector (so each collector's totals stay right) and the opposite ledger
// posting. Returns the amount reversed (0 when nothing was collected).
export async function reversePayment(trx, payment) {
  const perCollector = await trx('ticket_payment_entries')
    .where({ payment_id: payment.id })
    .groupBy('collected_by')
    .select('collected_by')
    .sum('amount as total');
  let reversed = 0;
  for (const c of perCollector) {
    const total = round2(c.total);
    if (total === 0) continue;
    await trx('ticket_payment_entries').insert({ payment_id: payment.id, amount: -total, collected_by: c.collected_by });
    reversed += total;
  }
  reversed = round2(reversed);
  if (reversed > 0) await postChitCollection(trx, reversed, { reverse: true });
  await settlePayment(trx, payment.id);
  return reversed;
}

// Once a round's auction fixes the amount due, payments collected before it
// are re-checked: fully covered ones become paid, the rest show their balance.
export async function settleRoundPayments(trx, ticketId, roundNumber) {
  const rows = await trx('ticket_payments').where({ ticket_id: ticketId, round_number: roundNumber }).andWhere('amount', '>', 0).select('id');
  for (const r of rows) await settlePayment(trx, r.id);
}
