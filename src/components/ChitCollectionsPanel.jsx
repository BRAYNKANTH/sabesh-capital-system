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
    <div className="glass-card" style={{ padding: '24px', marginBottom: '20px' }}>
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
        <div style={{ overflowX: 'auto' }}>
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
                    {!r.auction_run && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>auction not run yet</div>}
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
    </div>
  );
}
