'use client';

import React from 'react';

// "Overdue 14d": shown on a payment that is unpaid or part-paid more than the
// grace period after its round's auction. Dark red on a pale red background
// (well above the 4.5:1 contrast needed), with the full wording for screen readers.
export default function ChitOverdueTag({ days }) {
  if (!(days > 0)) return null;
  return (
    <span
      aria-label={`Overdue by ${days} ${days === 1 ? 'day' : 'days'}`}
      style={{ display: 'inline-block', background: '#fde8e8', color: '#9b1c1c', fontWeight: 700, fontSize: '12px', borderRadius: '999px', padding: '2px 10px', whiteSpace: 'nowrap', lineHeight: 1.4 }}
    >
      Overdue {days}d
    </span>
  );
}
