'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One line per customer across every chit group (matched by phone number). A
// customer in two groups shows each chit's amount on its own, with a combined
// total and a single Collect button for the chits ticked on that line.
export default function ChitCollectCenter({ isAdmin, onClose, onChanged, showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [unticked, setUnticked] = useState({}); // payment_id -> true when the admin leaves that chit out
  const [confirming, setConfirming] = useState(null); // customer key awaiting "Confirm"
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.get('/tickets/collections'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedFor = (c) => c.chits.filter(x => !x.is_paid && !unticked[x.payment_id]);

  const collect = async (c) => {
    const picked = selectedFor(c);
    if (picked.length === 0) return;
    setSavingKey(c.key);
    try {
      const res = await api.post('/tickets/collections/collect', { payment_ids: picked.map(x => x.payment_id) });
      const smsNote = res.sms === 'sent' ? ' One thank-you SMS was sent.' : res.sms === 'no_phone' ? ' No phone number on file, so no SMS was sent.' : res.sms === 'failed' ? ' The SMS could not be sent (see More → SMS Log).' : res.sms === 'mocked' ? ' No SMS was sent because Text.lk is not set up.' : '';
      showToast(`Collected LKR ${money(res.total)} from ${c.name}.${smsNote}`, res.sms === 'failed' || res.sms === 'mocked' ? 'error' : 'success');
      setConfirming(null);
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
      setConfirming(null);
      await load();
    } finally {
      setSavingKey(null);
    }
  };

  const q = search.trim().toLowerCase();
  const customers = (data?.customers || []).filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '20px', margin: 0, fontWeight: 'bold' }}>Collect Chit Payments</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '4px 0 0' }}>
            One line per customer. Someone in two chit groups shows each amount separately and can pay both at once.
          </p>
        </div>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={onClose}>Close</button>
      </div>

      <input type="search" className="glass-input" placeholder="Search by name or phone" aria-label="Search customers" value={search} onChange={e => setSearch(e.target.value)} />

      {error && <p role="alert" style={{ color: 'var(--accent-rose)', fontSize: '13px' }}>{error}</p>}
      {!data && !error && <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</p>}
      {data && (
        <p style={{ fontSize: '13px', margin: 0 }}>
          Still to collect: <strong style={{ color: 'var(--accent-rose)' }}>LKR {money(data.totals.pending)}</strong> from <strong>{data.totals.pending_customers}</strong> customer(s)
        </p>
      )}
      {data && customers.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
          {data.customers.length === 0 ? 'Nothing to collect yet. Run a round\'s auction in a group to create its payments.' : 'No customer matches that search.'}
        </p>
      )}

      {customers.map(c => {
        const picked = selectedFor(c);
        const pickedTotal = picked.reduce((s, x) => s + x.balance, 0);
        return (
          <div key={c.key} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
              <strong style={{ fontSize: '15px' }}>{c.name}</strong>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{c.phone || 'no phone'}</span>
            </div>

            {c.chits.map(x => (
              <div key={x.payment_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '13px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: x.is_paid || !isAdmin ? 'default' : 'pointer' }}>
                  {!x.is_paid && isAdmin && (
                    <input type="checkbox" checked={!unticked[x.payment_id]} onChange={() => setUnticked(prev => ({ ...prev, [x.payment_id]: !prev[x.payment_id] }))} aria-label={`Include ${x.group_name} round ${x.round_number}`} style={{ width: '18px', height: '18px', accentColor: 'var(--accent-emerald)' }} />
                  )}
                  <span><strong>{x.group_name}</strong> <span style={{ color: 'var(--text-muted)' }}>Round {x.round_number}</span></span>
                </label>
                <span style={{ fontWeight: 'bold', textAlign: 'right', color: x.is_paid ? 'var(--accent-emerald)' : undefined }}>
                  {x.is_paid ? `Paid LKR ${money(x.amount_paid)}${x.collected_by_name ? ` · ${x.collected_by_name}` : ''}` : `LKR ${money(x.balance)}`}
                  {!x.is_paid && x.amount_paid > 0 && (
                    <span style={{ display: 'block', fontSize: '11px', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                      balance (paid LKR {money(x.amount_paid)} of {money(x.amount_due)})
                    </span>
                  )}
                </span>
              </div>
            ))}

            {c.chits.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-light)', paddingTop: '8px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Combined (both chits)</span>
                <strong>LKR {money(c.total_due)}</strong>
              </div>
            )}

            {isAdmin && c.pending_count > 0 && (
              confirming === c.key ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="glass-btn glass-btn-emerald" style={{ flex: 1, padding: '10px' }} disabled={savingKey === c.key} onClick={() => collect(c)}>
                    {savingKey === c.key ? 'Saving…' : `Confirm: collected LKR ${money(pickedTotal)}`}
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 14px' }} disabled={savingKey === c.key} onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '10px' }} disabled={picked.length === 0} onClick={() => setConfirming(c.key)}>
                  {picked.length === 0 ? 'Tick a chit to collect' : `Collect LKR ${money(pickedTotal)}${picked.length > 1 ? ` (${picked.length} chits)` : ''}`}
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
