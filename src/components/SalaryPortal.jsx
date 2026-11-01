'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';
import { ArrowLeft, Plus, Trash2, Wallet } from 'lucide-react';

const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '-');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
const NEW_TYPE = '__new__';

function Field({ id, label, children, hint }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' };

export default function SalaryPortal({ showToast, onBack }) {
  const [agents, setAgents] = useState([]);
  const [types, setTypes] = useState([]);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [filterAgent, setFilterAgent] = useState('');
  const [form, setForm] = useState({ agent_id: '', type_id: '', new_type_name: '', amount: '', paid_on: todayStr(), notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addingType = form.type_id === NEW_TYPE;

  const loadTypes = useCallback(async () => setTypes(await api.get('/salary/types')), []);

  const loadRecords = useCallback(async () => {
    setLoadError('');
    try {
      const qs = new URLSearchParams();
      if (month) qs.set('month', month);
      if (filterAgent) qs.set('agent_id', filterAgent);
      setData(await api.get(`/salary/payments?${qs}`));
    } catch (err) {
      setLoadError(err.message);
    }
  }, [month, filterAgent]);

  useEffect(() => {
    Promise.all([api.get('/users/agents'), loadTypes()])
      .then(([a]) => setAgents(a))
      .catch((err) => setLoadError(err.message));
  }, [loadTypes]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.agent_id) return setFormError('Choose who the money was given to.');
    if (!form.type_id) return setFormError('Choose a salary type, or pick "Add new type".');
    if (addingType && !form.new_type_name.trim()) return setFormError('Type a name for the new salary type.');
    setSaving(true);
    try {
      const res = await api.post('/salary/payments', {
        agent_id: form.agent_id,
        type_id: addingType ? undefined : form.type_id,
        new_type_name: addingType ? form.new_type_name : undefined,
        amount: form.amount,
        paid_on: form.paid_on,
        notes: form.notes
      });
      showToast(res.message);
      // Keep the agent and date for the next entry; clear what changes each time.
      setForm((f) => ({ ...f, type_id: res.type_id, new_type_name: '', amount: '', notes: '' }));
      await Promise.all([loadTypes(), loadRecords()]);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete this record?\n\n${p.type_name} — ${money(p.amount)} to ${p.agent_name} on ${fmtDate(p.paid_on)}`)) return;
    try {
      await api.delete(`/salary/payments/${p.id}`);
      showToast('Record deleted.');
      loadRecords();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

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
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Record money given to agents</span>
        </div>
      </div>

      {loadError && <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>Could not load: {loadError}</div>}

      <form onSubmit={submit} className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>Give money</h3>
        {formError && <div role="alert" style={{ color: 'var(--accent-rose)', fontSize: '14px' }}>{formError}</div>}
        <div style={grid}>
          <Field id="sal-agent" label="Given to *">
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
          <Field id="sal-date" label="Date *">
            <input id="sal-date" className="glass-input" type="date" required value={form.paid_on} onChange={(e) => set('paid_on', e.target.value)} />
          </Field>
        </div>
        <Field id="sal-notes" label="Note">
          <input id="sal-notes" className="glass-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </Field>
        <div>
          <button type="submit" className="glass-btn glass-btn-emerald" style={{ padding: '12px 20px' }} disabled={saving}>
            <Plus className="icon" /> {saving ? 'Saving…' : 'Record'}
          </button>
        </div>
      </form>

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field id="sal-month" label="Month">
          <input id="sal-month" className="glass-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field id="sal-filter-agent" label="Agent">
          <select id="sal-filter-agent" className="glass-input" value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {month && (
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 14px', fontSize: '13px' }} onClick={() => setMonth('')}>All time</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="kpi-card kpi-card-emerald"><span className="kpi-lbl">Total given</span><h3 className="kpi-val">{data ? money(data.total) : '…'}</h3></div>
        {(data?.byType || []).map((t) => (
          <div key={t.type_id} className="kpi-card"><span className="kpi-lbl">{t.type_name}</span><h3 className="kpi-val">{money(t.total)}</h3></div>
        ))}
      </div>

      {data && !filterAgent && data.byAgent.length > 0 && (
        <section className="glass-card" style={{ padding: '18px 22px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '16px' }}>By agent</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.byAgent.map((a) => (
              <div key={a.agent_id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px' }}>
                <span>{a.agent_name}</span><strong>{money(a.total)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {data === null ? (
        <div className="glass-card" style={{ padding: '24px' }}>Loading…</div>
      ) : data.payments.length === 0 ? (
        <div className="glass-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Nothing recorded {month ? 'for this month' : 'yet'}. Use "Give money" above to add the first one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {data.payments.map((p) => (
            <div key={p.id} className="glass-card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Wallet className="icon" aria-hidden="true" />
                  <strong>{p.agent_name}</strong>
                  <span className="badge badge-active">{p.type_name}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {fmtDate(p.paid_on)}{p.notes ? ` · ${p.notes}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <strong>{money(p.amount)}</strong>
                <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px' }} aria-label={`Delete ${p.type_name} record for ${p.agent_name}`} onClick={() => remove(p)}>
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
