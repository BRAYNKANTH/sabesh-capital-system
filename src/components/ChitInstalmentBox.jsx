'use client';

import React, { useState } from 'react';

// The amount box for one member's payment: type what they paid and press
// Collect. Once the round's auction has set the amount due, leaving the box
// empty collects the whole balance. `payment` is a row from
// /tickets/:id/payments (amount = collected so far, amount_due = what the round
// asks of each member, null until the auction is run). Money already collected
// can be taken back with Undo.
export default function ChitInstalmentBox({ payment, onCollect, onUndo, busy, fullWidth = false }) {
  const [value, setValue] = useState('');
  const collected = parseFloat(payment.amount) || 0;
  const due = payment.amount_due === null || payment.amount_due === undefined ? null : parseFloat(payment.amount_due);
  const cents = (n) => Math.round(n * 100) / 100;
  const balance = due === null ? null : Math.max(0, cents(cents(due) - cents(collected)));
  const takesBalance = value === '' && balance > 0;

  // Fully paid: nothing more to collect, only a way to take it back.
  if (payment.is_paid) {
    return onUndo && payment.id ? (
      <button type="button" className="glass-btn glass-btn-secondary" style={fullWidth ? { padding: '10px 14px', fontSize: '13px', width: '100%' } : { padding: '5px 10px', fontSize: '11px', marginTop: '6px' }} disabled={busy} onClick={() => onUndo(payment)} title="Take back everything collected from this member for this round">
        Undo payment
      </button>
    ) : null;
  }

  const submit = async (e) => {
    e.preventDefault();
    const amount = value === '' ? balance : parseFloat(value);
    if (!(amount > 0)) return;
    const ok = await onCollect(payment, amount);
    if (ok) setValue('');
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: fullWidth ? 0 : '6px' }}>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className="glass-input"
        style={fullWidth
          ? { flex: '1 1 140px', minWidth: 0, padding: '10px 12px', fontSize: '16px' }
          : { width: '130px', padding: '5px 8px', fontSize: '12px' }}
        aria-label={`Amount collected from ${payment.member_name}`}
        placeholder="Amount"
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button type="submit" className="glass-btn glass-btn-emerald" style={fullWidth ? { padding: '10px 14px', fontSize: '13px' } : { padding: '5px 10px', fontSize: '11px' }} disabled={busy || (value === '' && !(balance > 0))}>
        {busy ? 'Saving…' : takesBalance ? 'Collect balance' : 'Collect'}
      </button>
      {onUndo && collected > 0 && payment.id && (
        <button type="button" className="glass-btn glass-btn-secondary" style={fullWidth ? { padding: '10px 14px', fontSize: '13px' } : { padding: '5px 10px', fontSize: '11px' }} disabled={busy} onClick={() => onUndo(payment)} title="Take back everything collected from this member for this round">
          Undo
        </button>
      )}
    </form>
  );
}
