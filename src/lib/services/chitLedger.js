// Chit fund collections post to the same double-entry ledger as loan
// repayments, so they show up in the Ledger / Trial Balance report. Every
// payment collected is cash at the office (only admins record collections)
// owed to the group, so ticking a payment paid debits cash and credits the
// chit collections account, and un-ticking posts the exact opposite.
export const CHIT_COLLECTIONS_ACCOUNT = 'chit_collections';

export async function postChitCollection(trx, amount, { reverse = false } = {}) {
  const value = Number(amount);
  if (!(value > 0)) return;
  await trx('ledger_entries').insert([
    { account: 'cash_office', type: reverse ? 'credit' : 'debit', amount: value },
    { account: CHIT_COLLECTIONS_ACCOUNT, type: reverse ? 'debit' : 'credit', amount: value }
  ]);
}
