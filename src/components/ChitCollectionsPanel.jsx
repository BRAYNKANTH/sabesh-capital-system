'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Per-term collection summary for one group. Collecting money happens in the
// Collect Payments table below it (one table for every round, including the
// round whose auction has not been run yet).
export default function ChitCollectionsPanel({ ticket, refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setSummary(await api.get(`/tickets/${ticket.id}/collections`));
    } catch (err) {
      setError(err.message);
    }
  }, [ticket.id]);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div className="glass-card" style={{ padding: '24px', marginTop: '20px' }}>
      <h3 style={{ fontSize: '18px', margin: '0 0 4px', fontWeight: 'bold' }}>Collection Summary by Term</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '0 0 14px' }}>
        What was due, what has been collected and who collected it, for every round. "Paid" counts members who have paid in full.
      </p>
      {error && <p role="alert" style={{ color: 'var(--accent-rose)', fontSize: '13px' }}>{error}</p>}
      {!summary ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</p>
      ) : summary.rounds.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '12px' }}>No collections yet.</p>
      ) : (
        <div className="desktop-only" style={{ overflowX: 'auto' }}>
          <table className="glass-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Paid</th>
                <th>Due</th>
                <th>Collected</th>
                <th>Outstanding</th>
                <th>Collected By</th>
              </tr>
            </thead>
            <tbody>
              {summary.rounds.map(r => (
                <tr key={r.round_number}>
                  <td>
                    <strong>Round {r.round_number}</strong>
                    {!r.auction_run && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>auction not run yet</div>}
                  </td>
                  <td>{r.paid_count} of {r.members_total}</td>
                  <td>{r.expected === null ? '—' : `LKR ${money(r.expected)}`}</td>
                  <td style={{ fontWeight: 'bold', color: 'var(--accent-emerald)' }}>LKR {money(r.collected)}</td>
                  <td style={{ color: r.outstanding ? 'var(--accent-rose)' : undefined }}>{r.outstanding === null ? '—' : `LKR ${money(r.outstanding)}`}</td>
                  <td>
                    {r.collectors.length === 0 ? '—' : r.collectors.map(c => (
                      <div key={c.name} style={{ fontSize: '12px' }}>{c.name}: LKR {money(c.amount)} ({c.count})</div>
                    ))}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}><strong>All terms</strong></td>
                <td><strong>LKR {money(summary.totals.expected)}</strong></td>
                <td><strong style={{ color: 'var(--accent-emerald)' }}>LKR {money(summary.totals.collected)}</strong></td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {summary && summary.rounds.length > 0 && (
        <div className="mobile-only mobile-card-list" style={{ marginTop: 0 }}>
          {summary.rounds.map(r => (
            <div key={r.round_number} className="mobile-row-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                <span className="mobile-row-card-title">Round {r.round_number}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.auction_run ? `${r.paid_count} of ${r.members_total} paid` : 'auction not run yet'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                {[
                  ['Due', r.expected === null ? '—' : `LKR ${money(r.expected)}`, undefined],
                  ['Collected', `LKR ${money(r.collected)}`, 'var(--accent-emerald)'],
                  ['Left', r.outstanding === null ? '—' : r.outstanding ? `LKR ${money(r.outstanding)}` : '—', r.outstanding ? 'var(--accent-rose)' : 'var(--text-muted)']
                ].map(([label, value, color]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <span className="mobile-row-card-label" style={{ display: 'block', margin: 0 }}>{label}</span>
                    <strong style={{ fontSize: '14px', color, overflowWrap: 'anywhere' }}>{value}</strong>
                  </div>
                ))}
              </div>
              {r.collectors.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {r.collectors.map(c => `${c.name}: LKR ${money(c.amount)} (${c.count})`).join(' · ')}
                </div>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', paddingTop: '4px' }}>
            <strong>All rounds</strong>
            <span>Collected <strong style={{ color: 'var(--accent-emerald)' }}>LKR {money(summary.totals.collected)}</strong> of LKR {money(summary.totals.expected)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
