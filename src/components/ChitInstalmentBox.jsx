'use client';

import React, { useState } from 'react';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Paid X · Balance Y" and an amount box for collecting part of what a member
// owes. Leave the box empty and the whole balance is collected with one tap.
// `payment` is a row from /tickets/:id/payments (amount = collected so far,
// amount_due = what the round asks of each member).
export default function ChitInstalmentBox({ payment, onCollect, busy }) {
  const [value, setValue] = useState('');
  const collected = parseFloat(payment.amount) || 0;
  const due = payment.amount_due === null || payment.amount_due === undefined ? null : parseFloat(payment.amount_due);
  const balance = due === null ? null : Math.max(0, due - collected);

  const submit = async (e) => {
    e.preventDefault();
    const amount = value === '' ? balance : parseFloat(value);
    if (!(amount > 0)) return;
    const ok = await onCollect(payment.id, amount);
    if (ok) setValue('');
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className="glass-input"
        style={{ width: '110px', padding: '5px 8px', fontSize: '12px' }}
        aria-label={`Amount collected from ${payment.member_name}`}
        placeholder={balance !== null ? `Balance ${money(balance)}` : 'Amount'}
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button type="submit" className="glass-btn glass-btn-emerald" style={{ padding: '5px 10px', fontSize: '11px' }} disabled={busy || (value === '' && !(balance > 0))}>
        {busy ? 'Saving…' : value === '' ? 'Collect balance' : 'Collect'}
      </button>
    </form>
  );
}
