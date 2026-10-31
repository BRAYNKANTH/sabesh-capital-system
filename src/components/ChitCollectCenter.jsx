'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/apiClient.js';
import { groupTotals } from '@/lib/services/chitCollections.js';
import { chipColors } from '@/lib/services/chitCode.js';
import ChitInstalmentBox from './ChitInstalmentBox.jsx';
import ChitGroupChip from './ChitGroupChip.jsx';
import ChitOverdueTag from './ChitOverdueTag.jsx';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dial = (phone) => (phone || '').replace(/[^0-9+]/g, '');
const whatsappNumber = (phone) => {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? `94${digits.slice(1)}` : digits;
};
const initials = (name) => (String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
const MAX_COMBINED = 20; // the combined-collect request takes up to 20 payments at once

const smsNote = (sms) => (
  sms === 'sent' ? ' A thank-you SMS was sent.'
    : sms === 'no_phone' ? ' No phone number on file, so no SMS was sent.'
      : sms === 'failed' ? ' The SMS could not be sent (see More → SMS Log).'
        : sms === 'mocked' ? ' No SMS was sent because Text.lk is not set up.'
          : ''
);

const STATUS = {
  paid: { label: 'Paid', color: 'var(--accent-emerald)' },
  partial: { label: 'Partial', color: 'var(--accent-gold)' },
  pending: { label: 'Pending', color: 'var(--text-secondary)' }
};
const statusOf = (x) => (x.is_paid ? 'paid' : x.amount_paid ? 'partial' : 'pending');

const card = { background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '18px', boxShadow: 'var(--shadow-sm)' };
const smallCaps = { fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' };

function Avatar({ name }) {
  const { bg, fg } = chipColors(name);
  return (
    <span aria-hidden="true" style={{ width: '44px', height: '44px', borderRadius: '50%', background: bg, color: fg, fontWeight: 800, fontSize: '15px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials(name)}
    </span>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="mobile-row-card-label" style={{ display: 'block', margin: 0 }}>{label}</span>
      <strong style={{ fontSize: '14px', color, overflowWrap: 'anywhere' }}>{value}</strong>
    </div>
  );
}

// Everyone who still owes money, across every chit group. A total at the top, an
// overview by group, then one card per person. Someone in two or three groups
// (matched by phone number) has a single card with a separate, colour-coded line
// for each group and round they owe on; each line takes any amount (they can pay
// in parts), and one button collects every balance in one go.
export default function ChitCollectCenter({ isAdmin, onClose, onChanged, showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('owing'); // 'owing' | 'overdue' | 'paid' | 'all'
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

  const all = data?.customers || [];
  const owingCount = all.filter(c => c.pending_count > 0).length;
  const paidCount = all.length - owingCount;
  const overdueCount = all.filter(c => c.overdue_count > 0).length;
  const paymentsOwing = all.reduce((s, c) => s + c.pending_count, 0);
  const byGroup = groupTotals(all);

  const q = search.trim().toLowerCase();
  const customers = all
    .filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    .filter(c => filter === 'all' || (filter === 'owing' ? c.pending_count > 0 : filter === 'overdue' ? c.overdue_count > 0 : c.pending_count === 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '22px', margin: 0, fontWeight: 'bold' }}>Collect Payments</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '2px 0 0' }}>Everyone who owes, across all groups</p>
        </div>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px', fontSize: '13px', flexShrink: 0 }} onClick={onClose}>Close</button>
      </div>

      {error && <p role="alert" style={{ color: 'var(--accent-rose)', fontSize: '13px', margin: 0 }}>{error}</p>}
      {!data && !error && <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>Loading…</p>}

      {data && (
        <>
          {/* Overall total */}
          <div style={{ borderRadius: '20px', padding: '18px', color: '#fff', background: 'linear-gradient(135deg, #047857 0%, #065f46 100%)', boxShadow: 'var(--shadow-md)' }}>
            {data.totals.pending > 0 ? (
              <>
                <div style={{ ...smallCaps, opacity: 0.92 }}>Still to collect</div>
                <div style={{ fontFamily: 'var(--font-title)', fontSize: '30px', fontWeight: 800, lineHeight: 1.2, margin: '2px 0' }}>LKR {money(data.totals.pending)}</div>
                <div style={{ fontSize: '14px', opacity: 0.95 }}>
                  from {data.totals.pending_customers} {data.totals.pending_customers === 1 ? 'person' : 'people'} · {paymentsOwing} {paymentsOwing === 1 ? 'payment' : 'payments'}
                </div>
                {data.totals.overdue > 0 && (
                  <div style={{ marginTop: '10px', background: 'rgba(255, 255, 255, 0.16)', borderRadius: '12px', padding: '8px 12px', fontSize: '14px', fontWeight: 700 }}>
                    LKR {money(data.totals.overdue)} overdue · {data.totals.overdue_customers} {data.totals.overdue_customers === 1 ? 'person' : 'people'}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CheckCircle2 aria-hidden="true" style={{ width: '30px', height: '30px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-title)', fontSize: '20px', fontWeight: 800 }}>All collected</div>
                  <div style={{ fontSize: '14px', opacity: 0.95 }}>Nobody owes anything right now</div>
                </div>
              </div>
            )}
          </div>

          {/* Overview by group */}
          {byGroup.length > 0 && (
            <section aria-label="Still to collect by group" style={{ ...card, padding: '14px 16px' }}>
              <div style={{ ...smallCaps, color: 'var(--text-secondary)', marginBottom: '6px' }}>By group</div>
              {byGroup.map((g, i) => (
                <div key={g.ticket_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                    <ChitGroupChip code={g.code} />
                    <strong style={{ overflowWrap: 'anywhere' }}>{g.name}</strong>
                  </span>
                  <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <strong style={{ display: 'block', color: 'var(--accent-rose)' }}>LKR {money(g.pending)}</strong>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{g.people} {g.people === 1 ? 'person' : 'people'}</span>
                  </span>
                </div>
              ))}
            </section>
          )}

          {/* Find and filter */}
          <input type="search" className="glass-input" placeholder="Search by name or phone" aria-label="Search people" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="chit-seg" role="tablist" aria-label="Show" style={{ marginBottom: 0 }}>
            {[['owing', `Owing (${owingCount})`], ...(overdueCount > 0 ? [['overdue', `Overdue (${overdueCount})`]] : []), ['paid', `Paid (${paidCount})`], ['all', 'All']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>

          {customers.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: '16px', margin: 0 }}>
              {all.length === 0
                ? 'Nothing to collect yet. Run a round\'s auction in a group to create its payments.'
                : q ? 'No one matches that search.'
                  : filter === 'owing' ? 'Everyone has paid.' : filter === 'overdue' ? 'Nothing is overdue.' : 'No one here yet.'}
            </p>
          )}
        </>
      )}

      {customers.map(c => {
        const unpaid = c.chits.filter(x => !x.is_paid);
        const owes = c.pending_count > 0;
        return (
          <section key={c.key} aria-label={c.name} style={{ ...card, overflow: 'hidden', opacity: owes ? 1 : 0.92 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px 12px' }}>
              <Avatar name={c.name} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: '17px', display: 'block', overflowWrap: 'anywhere', lineHeight: 1.25 }}>{c.name}</strong>
                {dial(c.phone) ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '14px', marginTop: '4px' }}>
                    <a href={`tel:${dial(c.phone)}`} className="phone-link" aria-label={`Call ${c.phone}`}>{c.phone}</a>
                    <a href={`https://wa.me/${whatsappNumber(c.phone)}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp chit-hit" title="Chat on WhatsApp" aria-label={`WhatsApp ${c.phone}`}>
                      <MessageSquare style={{ width: '12px', height: '12px' }} aria-hidden="true" />
                    </a>
                  </span>
                ) : <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>no phone</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 16px', background: owes ? 'rgba(220, 38, 38, 0.07)' : 'rgba(4, 120, 87, 0.08)', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
              {owes ? (
                <>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ ...smallCaps, color: 'var(--text-secondary)' }}>Owes</span>
                    {c.overdue_count > 0 && <ChitOverdueTag days={c.max_overdue_days} />}
                  </span>
                  <strong style={{ fontSize: '19px', color: 'var(--accent-rose)', whiteSpace: 'nowrap' }}>LKR {money(c.total_pending)}</strong>
                </>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 700, color: 'var(--accent-emerald)' }}>
                  <CheckCircle2 aria-hidden="true" style={{ width: '18px', height: '18px' }} /> All paid
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' }}>
              {c.chits.map(x => {
                const st = STATUS[statusOf(x)];
                const accent = x.group_code ? chipColors(x.group_code).fg : 'var(--border-strong)';
                const pct = x.amount_due > 0 ? Math.min(100, Math.round(((x.amount_paid || 0) / x.amount_due) * 100)) : 0;
                return (
                  <div key={x.payment_id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderLeft: `5px solid ${accent}`, borderRadius: '14px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
                        <ChitGroupChip code={x.group_code} />
                        <strong style={{ overflowWrap: 'anywhere' }}>{x.group_name}</strong>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Round {x.round_number}</span>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
                        <ChitOverdueTag days={x.overdue_days} />
                        <span style={{ fontSize: '12px', fontWeight: 700, color: st.color, border: `1px solid ${st.color}`, borderRadius: '999px', padding: '2px 10px', whiteSpace: 'nowrap' }}>{st.label}</span>
                      </span>
                    </div>

                    <div aria-hidden="true" style={{ height: '6px', borderRadius: '999px', background: 'var(--border-light)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-emerald)', borderRadius: '999px' }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                      <Stat label="Due" value={`LKR ${money(x.amount_due)}`} />
                      <Stat label="Paid" value={x.amount_paid ? `LKR ${money(x.amount_paid)}` : '—'} color={x.amount_paid ? 'var(--accent-emerald)' : 'var(--text-muted)'} />
                      <Stat label="Balance" value={x.balance > 0 ? `LKR ${money(x.balance)}` : '—'} color={x.balance > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'} />
                    </div>

                    {x.is_paid && x.collected_by_name && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Collected by {x.collected_by_name}</div>}
                    {isAdmin && !x.is_paid && (
                      <ChitInstalmentBox
                        payment={{ id: x.payment_id, member_name: c.name, amount: x.amount_paid, amount_due: x.amount_due, is_paid: false, _ticket_id: x.ticket_id }}
                        onCollect={collectLine}
                        busy={busy === x.payment_id || (!!busy && busy === c.key)}
                        fullWidth
                      />
                    )}
                  </div>
                );
              })}

              {isAdmin && unpaid.length > 1 && unpaid.length <= MAX_COMBINED && (
                confirming === c.key ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="glass-btn glass-btn-emerald" style={{ flex: 1, padding: '14px', fontSize: '14px' }} disabled={!!busy} onClick={() => collectAll(c)}>
                      {busy === c.key ? 'Saving…' : `Confirm: collected LKR ${money(c.total_pending)}`}
                    </button>
                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '14px 16px' }} disabled={!!busy} onClick={() => setConfirming(null)}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '14px', fontSize: '14px' }} disabled={!!busy} onClick={() => setConfirming(c.key)}>
                    Collect all balances · LKR {money(c.total_pending)} ({unpaid.length} payments)
                  </button>
                )
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
