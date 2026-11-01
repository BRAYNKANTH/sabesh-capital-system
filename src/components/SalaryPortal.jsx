'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';
import { ArrowLeft, Plus, Trash2, Wallet, Check } from 'lucide-react';

const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '-');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
const NEW_TYPE = '__new__';

const KINDS = [
  { key: '', label: 'Salary + allowances' },
  { key: 'salary', label: 'Salary only' },
  { key: 'allowance', label: 'Allowances only' }
];
const STATUSES = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'To pay back' },
  { key: 'paid', label: 'Paid' }
];

function Field({ id, label, children, hint }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key}
          className={`glass-btn ${value === o.key ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
          style={{ padding: '8px 14px', fontSize: '13px' }} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' };

export default function SalaryPortal({ showToast, onBack }) {
  const [agents, setAgents] = useState([]);
  const [types, setTypes] = useState([]);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('records'); // records | agents
  const [filters, setFilters] = useState({ month: todayStr().slice(0, 7), agent_id: '', type_id: '', kind: '', status: '' });
  const [form, setForm] = useState({ agent_id: '', type_id: '', new_type_name: '', amount: '', paid_on: todayStr(), notes: '', status: 'paid' });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [formError, setFormError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const addingType = form.type_id === NEW_TYPE;

  const loadTypes = useCallback(async () => setTypes(await api.get('/salary/types')), []);

  const loadRecords = useCallback(async () => {
    setLoadError('');
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setData(await api.get(`/salary/payments?${qs}`));
    } catch (err) {
      setLoadError(err.message);
    }
  }, [filters]);

  useEffect(() => {
    Promise.all([api.get('/users/agents'), loadTypes()])
      .then(([a]) => setAgents(a))
      .catch((err) => setLoadError(err.message));
  }, [loadTypes]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.agent_id) return setFormError('Choose the agent.');
    if (!form.type_id) return setFormError('Choose a type, or pick "Add new type".');
    if (addingType && !form.new_type_name.trim()) return setFormError('Type a name for the new type.');
    setSaving(true);
    try {
      const res = await api.post('/salary/payments', {
        agent_id: form.agent_id,
        type_id: addingType ? undefined : form.type_id,
        new_type_name: addingType ? form.new_type_name : undefined,
        amount: form.amount,
        paid_on: form.paid_on,
        notes: form.notes,
        status: form.status
      });
      showToast(res.message);
      // Keep the agent, date and "how" for the next entry; clear what changes each time.
      setForm((f) => ({ ...f, type_id: res.type_id, new_type_name: '', amount: '', notes: '' }));
      await Promise.all([loadTypes(), loadRecords()]);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (p) => {
    if (!window.confirm(`Mark as paid?\n\n${money(p.amount)} (${p.type_name}) to ${p.agent_name}`)) return;
    setBusyId(p.id);
    try {
      const res = await api.patch(`/salary/payments/${p.id}`, {});
      showToast(res.message);
      loadRecords();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete this record?\n\n${p.type_name} — ${money(p.amount)} for ${p.agent_name} on ${fmtDate(p.paid_on)}`)) return;
    setBusyId(p.id);
    try {
      await api.delete(`/salary/payments/${p.id}`);
      showToast('Record deleted.');
      loadRecords();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Figures for the current filters.
  const rows = data?.rows || [];
  const sum = (pred) => rows.filter(pred).reduce((s, r) => s + Number(r.total), 0);
  const totalPaid = sum((r) => r.status === 'paid');
  const totalOwed = sum((r) => r.status === 'pending');
  const byType = [...rows.reduce((m, r) => m.set(r.type_id, { name: r.type_name, paid: (m.get(r.type_id)?.paid || 0) + (r.status === 'paid' ? Number(r.total) : 0), owed: (m.get(r.type_id)?.owed || 0) + (r.status === 'pending' ? Number(r.total) : 0) }), new Map()).entries()];
  const byAgent = [...rows.reduce((m, r) => {
    const a = m.get(r.agent_id) || { id: r.agent_id, name: r.agent_name, salary: 0, allowance: 0, owed: 0, lines: [] };
    if (r.status === 'paid') a[r.kind === 'salary' ? 'salary' : 'allowance'] += Number(r.total);
    else a.owed += Number(r.total);
    a.lines.push(r);
    return m.set(r.agent_id, a);
  }, new Map()).values()];

  const filterTypes = filters.kind ? types.filter((t) => t.kind === filters.kind) : types;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        {onBack && (
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={onBack}>
            <ArrowLeft className="icon" /> Main Selector
          </button>
        )}
        <div>
          <h2 style={{ fontSize: '28px', margin: 0 }}>Salary &amp; Allowances</h2>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Money given to agents, and money they spent that you owe them</span>
        </div>
      </div>

      {loadError && <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>Could not load: {loadError}</div>}

      <form onSubmit={submit} className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>Add an entry</h3>
        <Segmented label="How was it paid" value={form.status} onChange={(v) => set('status', v)} options={[
          { key: 'paid', label: 'I gave the money' },
          { key: 'pending', label: 'Agent spent their own — pay later' }
        ]} />
        {form.status === 'pending' && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            It is saved as <strong>To pay back</strong>. When you hand the money over, tap <strong>Mark paid</strong> on it.
          </div>
        )}
        {formError && <div role="alert" style={{ color: 'var(--accent-rose)', fontSize: '14px' }}>{formError}</div>}
        <div style={grid}>
          <Field id="sal-agent" label="Agent *">
            <select id="sal-agent" className="glass-input" value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)}>
              <option value="">Choose agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field id="sal-type" label="Type *">
            <select id="sal-type" className="glass-input" value={form.type_id} onChange={(e) => set('type_id', e.target.value)}>
              <option value="">Choose type…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value={NEW_TYPE}>+ Add new type…</option>
            </select>
          </Field>
          {addingType && (
            <Field id="sal-newtype" label="New type name *" hint="Saved so you can pick it next time.">
              <input id="sal-newtype" className="glass-input" value={form.new_type_name} maxLength={80} autoFocus autoComplete="off"
                placeholder="e.g. Phone Allowance" onChange={(e) => set('new_type_name', e.target.value)} />
            </Field>
          )}
          <Field id="sal-amount" label="Amount (LKR) *">
            <input id="sal-amount" className="glass-input" type="number" min="0.01" step="0.01" inputMode="decimal" required
              value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </Field>
          <Field id="sal-date" label={form.status === 'pending' ? 'Date spent *' : 'Date given *'}>
            <input id="sal-date" className="glass-input" type="date" required value={form.paid_on} onChange={(e) => set('paid_on', e.target.value)} />
          </Field>
        </div>
        <Field id="sal-notes" label="Note">
          <input id="sal-notes" className="glass-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional, e.g. petrol for route visits" />
        </Field>
        <div>
          <button type="submit" className="glass-btn glass-btn-emerald" style={{ padding: '12px 20px' }} disabled={saving}>
            <Plus className="icon" /> {saving ? 'Saving…' : form.status === 'pending' ? 'Save as to pay back' : 'Record'}
          </button>
        </div>
      </form>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Segmented label="Show" value={filters.kind} onChange={(v) => setFilters((f) => ({ ...f, kind: v, type_id: '' }))} options={KINDS} />
        <Segmented label="Payment status" value={filters.status} onChange={(v) => setFilter('status', v)} options={STATUSES} />
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field id="sal-month" label="Month">
            <input id="sal-month" className="glass-input" type="month" value={filters.month} onChange={(e) => setFilter('month', e.target.value)} />
          </Field>
          <Field id="sal-filter-agent" label="Agent">
            <select id="sal-filter-agent" className="glass-input" value={filters.agent_id} onChange={(e) => setFilter('agent_id', e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field id="sal-filter-type" label="Type">
            <select id="sal-filter-type" className="glass-input" value={filters.type_id} onChange={(e) => setFilter('type_id', e.target.value)}>
              <option value="">All types</option>
              {filterTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {filters.month && (
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 14px', fontSize: '13px' }} onClick={() => setFilter('month', '')}>All time</button>
          )}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="kpi-card kpi-card-emerald"><span className="kpi-lbl">Paid</span><h3 className="kpi-val">{data ? money(totalPaid) : '…'}</h3></div>
        <div className="kpi-card kpi-card-rose"><span className="kpi-lbl">To pay back</span><h3 className="kpi-val">{data ? money(totalOwed) : '…'}</h3><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Spent by agents, not yet paid</span></div>
        {byType.map(([id, t]) => (
          <div key={id} className="kpi-card"><span className="kpi-lbl">{t.name}</span><h3 className="kpi-val">{money(t.paid)}</h3>
            {t.owed > 0 && <span style={{ fontSize: '12px', color: 'var(--accent-rose)' }}>+ {money(t.owed)} to pay back</span>}</div>
        ))}
      </div>

      <Segmented label="View" value={tab} onChange={setTab} options={[{ key: 'records', label: 'All records' }, { key: 'agents', label: 'By agent' }]} />

      {data === null ? (
        <div className="glass-card" style={{ padding: '24px' }}>Loading…</div>
      ) : tab === 'agents' ? (
        byAgent.length === 0 ? (
          <div className="glass-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>No records match these filters.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {byAgent.map((a) => (
              <div key={a.id} className="glass-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <strong style={{ fontSize: '17px' }}>{a.name}</strong>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}><span>Salary</span><strong>{money(a.salary)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}><span>Allowances</span><strong>{money(a.allowance)}</strong></div>
                {a.owed > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--accent-rose)' }}><span>To pay back</span><strong>{money(a.owed)}</strong></div>}
                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {a.lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      <span>{l.type_name}{l.status === 'pending' ? ' (to pay back)' : ''}</span><span>{money(l.total)}</span>
                    </div>
                  ))}
                </div>
                <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 12px', fontSize: '13px' }}
                  onClick={() => { setFilter('agent_id', a.id); setTab('records'); }}>See records</button>
              </div>
            ))}
          </div>
        )
      ) : data.payments.length === 0 ? (
        <div className="glass-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Nothing matches these filters. Use "Add an entry" above to record one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {data.payments.map((p) => (
            <div key={p.id} className="glass-card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Wallet className="icon" aria-hidden="true" />
                  <strong>{p.agent_name}</strong>
                  <span className="badge badge-active">{p.type_name}</span>
                  {p.status === 'pending'
                    ? <span className="badge badge-pending">To pay back</span>
                    : <span className="badge badge-paid">Paid{p.settled_on && p.settled_on !== p.paid_on ? ` ${fmtDate(p.settled_on)}` : ''}</span>}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {p.status === 'pending' ? 'Spent' : 'Given'} {fmtDate(p.paid_on)}{p.notes ? ` · ${p.notes}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <strong>{money(p.amount)}</strong>
                {p.status === 'pending' && (
                  <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '8px 14px', fontSize: '13px' }} disabled={busyId === p.id} onClick={() => markPaid(p)}>
                    <Check className="icon" /> Mark paid
                  </button>
                )}
                <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px' }} disabled={busyId === p.id}
                  aria-label={`Delete ${p.type_name} record for ${p.agent_name}`} onClick={() => remove(p)}>
                  <Trash2 className="icon" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
