'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Per-term collection summary, plus collecting a member's payment for the
// round whose auction has not been run yet (the amount is typed in, since no
// auction has set the figure; running the auction later links these payments).
export default function ChitCollectionsPanel({ ticket, members, isAdmin, refreshKey, onChanged, showToast }) {
  const [summary, setSummary] = useState(null);
  const [roundPayments, setRoundPayments] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  const open = ticket.status !== 'completed';
  const round = ticket.current_round;

  const load = useCallback(async () => {
    try {
      setError('');
      const [s, p] = await Promise.all([
        api.get(`/tickets/${ticket.id}/collections`),
        open ? api.get(`/tickets/${ticket.id}/payments?round=${round}`) : Promise.resolve([])
      ]);
      setSummary(s);
      setRoundPayments(p);
    } catch (err) {
      setError(err.message);
    }
  }, [ticket.id, open, round]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const paidByMember = new Map(roundPayments.filter(p => p.is_paid).map(p => [p.member_id, p]));

  const collect = async (member) => {
    const amount = parseFloat(amounts[member.id]);
    if (!(amount > 0)) { showToast('Enter the amount collected first.', 'error'); return; }
    setSavingId(member.id);
    try {
      const res = await api.post(`/tickets/${ticket.id}/payments`, { member_id: member.id, amount });
      const smsNote = res.sms === 'sent' ? ' A thank-you SMS was sent.' : res.sms === 'no_phone' ? ' No phone number on file, so no SMS was sent.' : res.sms === 'failed' ? ' The SMS could not be sent (see More → SMS Log).' : res.sms === 'mocked' ? ' No SMS was sent because Text.lk is not set up.' : '';
      showToast(`Collected LKR ${money(amount)} from ${member.name}.${smsNote}`, res.sms === 'failed' || res.sms === 'mocked' ? 'error' : 'success');
      setAmounts(prev => ({ ...prev, [member.id]: '' }));
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px' }}>
      <div className="glass-card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '18px', margin: '0 0 4px', fontWeight: 'bold' }}>Collection Summary by Term</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '0 0 14px' }}>
          What was due, what has been collected and who collected it, for every round.
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

      {open && (
        <div className="glass-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '18px', margin: '0 0 4px', fontWeight: 'bold' }}>Collect for Round {round} (auction not run yet)</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '0 0 14px' }}>
            Enter what each member paid. These payments are attached to Round {round} automatically when you run its auction.
          </p>
          {members.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Add members to the group first.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {members.map(m => {
                const paid = paidByMember.get(m.id);
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '10px 14px' }}>
                    <strong style={{ fontSize: '14px' }}>{m.name}</strong>
                    {paid ? (
                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-emerald)' }}>
                        Collected LKR {money(paid.amount)}{paid.collected_by_name ? ` by ${paid.collected_by_name}` : ''}
                      </span>
                    ) : isAdmin ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`Amount collected from ${m.name}`}
                          className="glass-input"
                          style={{ width: '130px', padding: '6px 10px' }}
                          placeholder="Amount"
                          value={amounts[m.id] || ''}
                          onChange={e => setAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                        />
                        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '6px 14px', fontSize: '12px' }} disabled={savingId === m.id} onClick={() => collect(m)}>
                          {savingId === m.id ? 'Saving…' : 'Collect'}
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Pending</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
