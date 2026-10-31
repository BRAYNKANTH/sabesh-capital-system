'use client';

import React from 'react';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// Whether a round's winner has been paid yet, and the buttons to record or take
// back that payout. `auction` is a row from /tickets/:id/auctions (collected_total
// is what has been collected for the round so far). payout_paid_at is undefined
// until the payouts migration has been run, so nothing is promised before then.
export default function ChitPayoutStatus({ auction, isAdmin, onPay, onUndo }) {
  if (!auction.winner_member_id) {
    return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Assign a winner to record the payout</span>;
  }
  if (auction.payout_paid_at === undefined) return null;

  const payout = parseFloat(auction.winner_payout) || 0;
  const collected = parseFloat(auction.collected_total) || 0;

  if (auction.payout_paid_at) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-emerald)', border: '1px solid var(--accent-emerald)', borderRadius: '999px', padding: '2px 10px' }}>
          Paid out {day(auction.payout_paid_at)}
        </span>
        {parseFloat(auction.payout_paid_amount) < payout && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>LKR {money(auction.payout_paid_amount)} of LKR {money(payout)}</span>
        )}
        {isAdmin && (
          <button type="button" className="glass-btn glass-btn-secondary" style={{ minHeight: '44px', padding: '6px 12px', fontSize: '13px' }} onClick={() => onUndo(auction)}>Undo payout</button>
        )}
      </div>
    );
  }

  const short = collected + 0.005 < payout;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-gold)', border: '1px solid var(--accent-gold)', borderRadius: '999px', padding: '2px 10px' }}>Not paid out yet</span>
      <span style={{ fontSize: '12px', color: short ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
        Collected LKR {money(collected)} of LKR {money(payout)}
      </span>
      {isAdmin && (
        <button type="button" className="glass-btn glass-btn-emerald" style={{ minHeight: '44px', padding: '6px 14px', fontSize: '13px' }} onClick={() => onPay(auction)}>Mark payout paid</button>
      )}
    </div>
  );
}
