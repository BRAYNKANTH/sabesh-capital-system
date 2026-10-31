'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '@/lib/apiClient.js';
import ChitInstalmentBox from './ChitInstalmentBox.jsx';
import ChitGroupChip from './ChitGroupChip.jsx';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dial = (phone) => (phone || '').replace(/[^0-9+]/g, '');
const whatsappNumber = (phone) => {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? `94${digits.slice(1)}` : digits;
};
const MAX_COMBINED = 20; // the combined-collect request takes up to 20 payments at once

const smsNote = (sms) => (
  sms === 'sent' ? ' A thank-you SMS was sent.'
    : sms === 'no_phone' ? ' No phone number on file, so no SMS was sent.'
      : sms === 'failed' ? ' The SMS could not be sent (see More → SMS Log).'
        : sms === 'mocked' ? ' No SMS was sent because Text.lk is not set up.'
          : ''
);

// Everyone who still owes money, across every chit group, one card per person.
// Someone in two or three groups (matched by phone number) has a single card
// with a line for each group and round they owe on; each line takes any amount
// (they can pay in parts), and one button collects every balance in one go.
export default function ChitCollectCenter({ isAdmin, onClose, onChanged, showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showPaid, setShowPaid] = useState(false);
  const [confirming, setConfirming] = useState(null); // customer key awaiting "Confirm"
  const [busy, setBusy] = useState(null); // payment id or customer key being saved

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.get('/tickets/collections'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Collects an amount from one line (one group and round) of a person.
  const collectLine = async (payment, amount) => {
    if (busy) return false;
    setBusy(payment.id);
    try {
      const res = await api.post(`/tickets/${payment._ticket_id}/payments`, { payment_id: payment.id, amount });
      const left = res.balance > 0 ? ` LKR ${money(res.balance)} still to pay.` : ' Fully paid.';
      showToast(`Collected LKR ${money(res.collected)} from ${payment.member_name}.${left}${smsNote(res.sms)}`, res.sms === 'failed' || res.sms === 'mocked' ? 'error' : 'success');
      await load();
      onChanged?.();
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Collects every balance this person owes, in one step and one SMS.
  const collectAll = async (c) => {
    const ids = c.chits.filter(x => !x.is_paid).map(x => x.payment_id);
    if (ids.length === 0 || ids.length > MAX_COMBINED || busy) return;
    setBusy(c.key);
    try {
      const res = await api.post('/tickets/collections/collect', { payment_ids: ids });
      showToast(`Collected LKR ${money(res.total)} from ${c.name}.${smsNote(res.sms)}`, res.sms === 'failed' || res.sms === 'mocked' ? 'error' : 'success');
      setConfirming(null);
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
      setConfirming(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const q = search.trim().toLowerCase();
  const matches = (data?.customers || []).filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
  const customers = matches.filter(c => showPaid || c.pending_count > 0);
  const hiddenPaid = matches.length - matches.filter(c => c.pending_count > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '20px', margin: 0, fontWeight: 'bold' }}>Collect Payments</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '4px 0 0' }}>
            Everyone who still owes money, across all groups. Someone in more than one group is shown once, with a line for each.
          </p>
        </div>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }} onClick={onClose}>Close</button>
      </div>

      <input type="search" className="glass-input" placeholder="Search by name or phone" aria-label="Search people" value={search} onChange={e => setSearch(e.target.value)} />

      {error && <p role="alert" style={{ color: 'var(--accent-rose)', fontSize: '13px', margin: 0 }}>{error}</p>}
      {!data && !error && <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>Loading…</p>}
      {data && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px' }}>
            Still to collect: <strong style={{ color: 'var(--accent-rose)' }}>LKR {money(data.totals.pending)}</strong> from <strong>{data.totals.pending_customers}</strong> {data.totals.pending_customers === 1 ? 'person' : 'people'}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} style={{ accentColor: 'var(--accent-emerald)' }} />
            Show people who have paid
          </label>
        </div>
      )}
      {data && customers.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '16px', margin: 0 }}>
          {data.customers.length === 0
            ? 'Nothing to collect yet. Run a round\'s auction in a group to create its payments.'
            : q ? 'No one matches that search.' : `Everyone has paid.${hiddenPaid > 0 ? ' Tick "Show people who have paid" to see them.' : ''}`}
        </p>
      )}

      {customers.map(c => {
        const unpaid = c.chits.filter(x => !x.is_paid);
        return (
          <div key={c.key} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: '16px', display: 'block', overflowWrap: 'anywhere' }}>{c.name}</strong>
                {dial(c.phone) ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginTop: '2px' }}>
                    <a href={`tel:${dial(c.phone)}`} className="phone-link" aria-label={`Call ${c.phone}`}>{c.phone}</a>
                    <a href={`https://wa.me/${whatsappNumber(c.phone)}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" title="Chat on WhatsApp" aria-label={`WhatsApp ${c.phone}`}>
                      <MessageSquare style={{ width: '12px', height: '12px' }} aria-hidden="true" />
                    </a>
                  </span>
                ) : <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>no phone</span>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {c.pending_count > 0 ? (
                  <>
                    <span className="mobile-row-card-label" style={{ display: 'block', margin: 0 }}>Owes</span>
                    <strong style={{ fontSize: '16px', color: 'var(--accent-rose)' }}>LKR {money(c.total_pending)}</strong>
                  </>
                ) : <strong style={{ fontSize: '13px', color: 'var(--accent-emerald)' }}>All paid</strong>}
              </div>
            </div>

            {c.chits.map(x => (
              <div key={x.payment_id} style={{ borderTop: '1px solid var(--border-light)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ overflowWrap: 'anywhere', display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <ChitGroupChip code={x.group_code} />
                    <strong>{x.group_name}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Round {x.round_number}</span>
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: x.is_paid ? 'var(--accent-emerald)' : x.amount_paid ? 'var(--accent-gold)' : 'var(--text-secondary)' }}>
                    {x.is_paid ? 'Paid' : x.amount_paid ? 'Partial' : 'Pending'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                  {[
                    ['Due', `LKR ${money(x.amount_due)}`, undefined],
                    ['Paid', x.amount_paid ? `LKR ${money(x.amount_paid)}` : '—', x.amount_paid ? 'var(--accent-emerald)' : 'var(--text-muted)'],
                    ['Balance', x.balance > 0 ? `LKR ${money(x.balance)}` : '—', x.balance > 0 ? 'var(--accent-rose)' : 'var(--text-muted)']
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ minWidth: 0 }}>
                      <span className="mobile-row-card-label" style={{ display: 'block', margin: 0 }}>{label}</span>
                      <strong style={{ fontSize: '14px', color, overflowWrap: 'anywhere' }}>{value}</strong>
                    </div>
                  ))}
                </div>
                {x.is_paid && x.collected_by_name && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Collected by {x.collected_by_name}</div>}
                {isAdmin && !x.is_paid && (
                  <ChitInstalmentBox
                    payment={{ id: x.payment_id, member_name: c.name, amount: x.amount_paid, amount_due: x.amount_due, is_paid: false, _ticket_id: x.ticket_id }}
                    onCollect={collectLine}
                    busy={busy === x.payment_id || (!!busy && busy === c.key)}
                    fullWidth
                  />
                )}
              </div>
            ))}

            {isAdmin && unpaid.length > 1 && unpaid.length <= MAX_COMBINED && (
              confirming === c.key ? (
                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
                  <button type="button" className="glass-btn glass-btn-emerald" style={{ flex: 1, padding: '12px' }} disabled={!!busy} onClick={() => collectAll(c)}>
                    {busy === c.key ? 'Saving…' : `Confirm: collected LKR ${money(c.total_pending)}`}
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '12px 14px' }} disabled={!!busy} onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '12px', borderTop: '1px solid var(--border-light)' }} disabled={!!busy} onClick={() => setConfirming(c.key)}>
                  Collect all balances · LKR {money(c.total_pending)} ({unpaid.length} payments)
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
