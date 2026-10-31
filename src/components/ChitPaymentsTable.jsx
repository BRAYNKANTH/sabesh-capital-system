'use client';

import React from 'react';
import { Phone, MessageSquare } from 'lucide-react';
import ChitInstalmentBox from './ChitInstalmentBox.jsx';
import ChitOverdueTag from './ChitOverdueTag.jsx';
import { overdueDays } from '@/lib/services/chitOverdue.js';
import { getSriLankaDateString } from '@/lib/loanSchedule.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Whole cents, so 0.1 + 0.2 style noise can never show as a balance.
const cents = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

const hasDue = (p) => p.amount_due !== null && p.amount_due !== undefined;
const paidSoFar = (p) => cents(p.amount);
const balanceOf = (p) => (hasDue(p) ? Math.max(0, cents(cents(p.amount_due) - paidSoFar(p))) : null);
// Money taken before the auction can turn out to be more than the amount due.
const overpaidBy = (p) => (hasDue(p) ? Math.max(0, cents(paidSoFar(p) - cents(p.amount_due))) : 0);

// Before the round's auction is run there is no amount due, so money taken
// then shows as "Received" until the auction decides whether it covers the due.
const statusOf = (p) => (p.is_paid ? 'Collected' : paidSoFar(p) > 0 ? (hasDue(p) ? 'Partial' : 'Received') : 'Pending');
const STATUS_COLOR = { Collected: 'var(--accent-emerald)', Partial: 'var(--accent-gold)', Received: 'var(--accent-gold)', Pending: 'var(--text-secondary)' };
const CARD_CLASS = { Collected: 'mobile-row-card-success', Partial: 'mobile-row-card-warning', Received: 'mobile-row-card-warning', Pending: '' };

const dial = (phone) => (phone || '').replace(/[^0-9+]/g, '');
const whatsappNumber = (phone) => {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? `94${digits.slice(1)}` : digits;
};

function Contact({ phone }) {
  if (!dial(phone)) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <a href={`tel:${dial(phone)}`} className="phone-link" aria-label={`Call ${phone}`}>{phone}</a>
      <a href={`https://wa.me/${whatsappNumber(phone)}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp chit-hit" title="Chat on WhatsApp" aria-label={`WhatsApp ${phone}`}>
        <MessageSquare style={{ width: '12px', height: '12px' }} aria-hidden="true" />
      </a>
    </span>
  );
}

function StatusPill({ p }) {
  const status = statusOf(p);
  return (
    <span style={{ fontSize: '12px', fontWeight: '700', color: STATUS_COLOR[status], border: `1px solid ${STATUS_COLOR[status]}`, borderRadius: '999px', padding: '2px 10px', whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function BalanceText({ p }) {
  const balance = balanceOf(p);
  if (balance === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  if (balance > 0) return <span style={{ color: 'var(--accent-rose)' }}>LKR {money(balance)}</span>;
  if (overpaidBy(p) > 0) return <span style={{ color: 'var(--accent-gold)' }}>Overpaid LKR {money(overpaidBy(p))}</span>;
  return <span style={{ color: 'var(--text-muted)' }}>—</span>;
}

// Days past due for an unpaid or part-paid row (0 when on time, paid, or before the auction).
const lateDays = (p) => (p.is_paid || !hasDue(p) ? 0 : overdueDays(p.auction_date, getSriLankaDateString()));

const lastPayment = (p) => (paidSoFar(p) > 0 && p.payment_date ? new Date(p.payment_date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null);

// One member per row (a card on phones): what is due, what has been paid, what
// is left, and a box to collect an amount. Used for every round, including the
// round whose auction has not been run, where there is no amount due yet.
export default function ChitPaymentsTable({ rows, isAdmin, busyKey, onCollect, onUndo }) {
  const keyOf = (p) => p.id || p.member_id;
  const cell = { padding: '12px 14px', fontSize: '14px', verticalAlign: 'top' };

  return (
    <>
      <div className="desktop-only" style={{ overflowX: 'auto' }}>
        <table className="glass-table">
          <thead>
            <tr>
              <th style={{ padding: '12px 14px' }}>Member</th>
              <th style={{ padding: '12px 14px' }}>Amount Due</th>
              <th style={{ padding: '12px 14px' }}>Paid</th>
              <th style={{ padding: '12px 14px' }}>Balance</th>
              <th style={{ padding: '12px 14px' }}>Status</th>
              <th style={{ padding: '12px 14px' }}>Last Payment</th>
              {isAdmin && <th style={{ padding: '12px 14px' }}>Collect</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={keyOf(p)}>
                <td style={cell}>
                  <strong style={{ display: 'block' }}>{p.member_name}</strong>
                  <div style={{ fontSize: '12px', marginTop: '2px' }}><Contact phone={p.member_phone} /></div>
                </td>
                <td style={{ ...cell, fontWeight: 'bold' }}>
                  {hasDue(p) ? `LKR ${money(p.amount_due)}` : <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', fontSize: '12px' }}>Set when the auction is run</span>}
                </td>
                <td style={{ ...cell, fontWeight: 'bold', color: paidSoFar(p) > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                  {paidSoFar(p) > 0 ? `LKR ${money(paidSoFar(p))}` : '—'}
                </td>
                <td style={{ ...cell, fontWeight: 'bold' }}><BalanceText p={p} /></td>
                <td style={cell}>
                  <StatusPill p={p} />
                  {lateDays(p) > 0 && <div style={{ marginTop: '6px' }}><ChitOverdueTag days={lateDays(p)} /></div>}
                </td>
                <td style={{ ...cell, fontSize: '13px' }}>
                  {lastPayment(p) ? (
                    <>
                      {lastPayment(p)}
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.collected_by_name || 'collector not recorded'}</div>
                    </>
                  ) : '—'}
                </td>
                {isAdmin && (
                  <td style={cell}>
                    <ChitInstalmentBox payment={p} onCollect={onCollect} onUndo={onUndo} busy={busyKey === keyOf(p)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-only mobile-card-list">
        {rows.map(p => (
          <div key={keyOf(p)} className={`mobile-row-card ${CARD_CLASS[statusOf(p)]}`} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span className="mobile-row-card-title" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.member_name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <ChitOverdueTag days={lateDays(p)} />
                <StatusPill p={p} />
              </span>
            </div>
            {dial(p.member_phone) && <div style={{ fontSize: '13px' }}><Contact phone={p.member_phone} /></div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
              {[
                ['Due', hasDue(p) ? `LKR ${money(p.amount_due)}` : 'After auction', hasDue(p) ? undefined : 'var(--text-muted)'],
                ['Paid', paidSoFar(p) > 0 ? `LKR ${money(paidSoFar(p))}` : '—', paidSoFar(p) > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)'],
                ['Balance', null, undefined]
              ].map(([label, value, color]) => (
                <div key={label} style={{ minWidth: 0 }}>
                  <span className="mobile-row-card-label" style={{ display: 'block', margin: 0 }}>{label}</span>
                  <strong style={{ display: 'block', fontSize: '14px', color, overflowWrap: 'anywhere' }}>
                    {label === 'Balance' ? <BalanceText p={p} /> : value}
                  </strong>
                </div>
              ))}
            </div>

            {lastPayment(p) && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Last payment {lastPayment(p)} · {p.collected_by_name || 'collector not recorded'}
              </div>
            )}

            {isAdmin && (
              <ChitInstalmentBox payment={p} onCollect={onCollect} onUndo={onUndo} busy={busyKey === keyOf(p)} fullWidth />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
