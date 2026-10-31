import { describe, it, expect } from 'vitest';
import { postChitCollection, postChitPayout, CHIT_COLLECTIONS_ACCOUNT } from './chitLedger.js';

function fakeTrx() {
  const inserted = [];
  const trx = () => ({ insert: async (rows) => { inserted.push(...rows); } });
  return { trx, inserted };
}

describe('postChitCollection', () => {
  it('debits cash and credits chit collections when a payment is collected', async () => {
    const { trx, inserted } = fakeTrx();
    await postChitCollection(trx, 2500);
    expect(inserted).toEqual([
      { account: 'cash_office', type: 'debit', amount: 2500 },
      { account: CHIT_COLLECTIONS_ACCOUNT, type: 'credit', amount: 2500 }
    ]);
  });

  it('posts the exact opposite when a payment is un-ticked', async () => {
    const { trx, inserted } = fakeTrx();
    await postChitCollection(trx, '2500.00', { reverse: true });
    expect(inserted).toEqual([
      { account: 'cash_office', type: 'credit', amount: 2500 },
      { account: CHIT_COLLECTIONS_ACCOUNT, type: 'debit', amount: 2500 }
    ]);
  });

  it('posts nothing for a missing or zero amount', async () => {
    const { trx, inserted } = fakeTrx();
    await postChitCollection(trx, null);
    await postChitCollection(trx, 0);
    expect(inserted).toEqual([]);
  });
});

describe('postChitPayout', () => {
  it('takes cash out and lowers the chit collections balance', async () => {
    const { trx, inserted } = fakeTrx();
    await postChitPayout(trx, 270000);
    expect(inserted).toEqual([
      { account: CHIT_COLLECTIONS_ACCOUNT, type: 'debit', amount: 270000 },
      { account: 'cash_office', type: 'credit', amount: 270000 }
    ]);
  });

  it('posts the exact opposite when a payout is undone', async () => {
    const { trx, inserted } = fakeTrx();
    await postChitPayout(trx, '270000.00', { reverse: true });
    expect(inserted).toEqual([
      { account: CHIT_COLLECTIONS_ACCOUNT, type: 'credit', amount: 270000 },
      { account: 'cash_office', type: 'debit', amount: 270000 }
    ]);
  });

  it('posts nothing for a missing or zero amount', async () => {
    const { trx, inserted } = fakeTrx();
    await postChitPayout(trx, 0);
    await postChitPayout(trx, null);
    expect(inserted).toEqual([]);
  });
});
