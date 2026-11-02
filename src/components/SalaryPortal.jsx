'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Plus, Trash2, Undo2 } from 'lucide-react';

const num = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
const shiftMonth = (m, by) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const netOf = (e) => Math.round(((+e.basic_salary || 0) + (+e.allowance_total || 0) + (+e.advance || 0) - (+e.deduction || 0)) * 100) / 100;

const NEW_TYPE = '__new__';

const th = { padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-light)' };
const td = { padding: '8px 12px', textAlign: 'right', fontSize: '14px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top' };
const left = { textAlign: 'left' };

// A number you type into. Saves when you leave it (or press Enter), only if it changed.
function MoneyInput({ value, disabled, label, onSave, width = '110px' }) {
  const shown = value ? String(value) : '';
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = () => {
    const next = draft === '' ? 0 : parseFloat(draft);
    if (Number.isNaN(next)) return setDraft(shown);
    if (next !== (value || 0)) onSave(next);
  };
  return (
    <input type="number" min="0" step="0.01" inputMode="decimal" className="glass-input" aria-label={label}
      value={draft} placeholder="–" disabled={disabled}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(shown); e.currentTarget.blur(); } }}
      style={{ width, textAlign: 'right', padding: '6px 8px' }} />
  );
}

// Allowance type dropdown, with "+ Add new type…" which turns into a small name box.
function TypeSelect({ value, types, usedIds = [], disabled, label, onPick, onCreate }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!name.trim()) return;
    setBusy(true);
    const ok = await onCreate(name);
    setBusy(false);
    if (ok) { setAdding(false); setName(''); }
  };

  if (adding) {
    return (
      <div style={{ display: 'flex', gap: '6px' }}>
        <input className="glass-input" aria-label="New allowance type name" placeholder="New type name" maxLength={80} autoFocus
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(e); if (e.key === 'Escape') setAdding(false); }}
          style={{ width: '150px', padding: '6px 8px' }} />
        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '6px 10px', fontSize: '12px' }} disabled={busy || !name.trim()} onClick={submit}>Add</button>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} aria-label="Cancel new type" onClick={() => setAdding(false)}>✕</button>
      </div>
    );
  }
  return (
    <select className="glass-input" aria-label={label} disabled={disabled} value={value || ''} style={{ width: '170px', padding: '6px 8px' }}
      onChange={(e) => (e.target.value === NEW_TYPE ? setAdding(true) : onPick(e.target.value || null))}>
      <option value="">Allowance type…</option>
      {types.map((t) => <option key={t.id} value={t.id} disabled={usedIds.includes(t.id) && t.id !== value}>{t.name}</option>)}
      <option value={NEW_TYPE}>+ Add new type…</option>
    </select>
  );
}

// The Allowances cell: one line per allowance (type + amount), "+ Add allowance" for another,
// and the running total underneath.
function AllowanceLines({ entry, types, locked, who, onAdd, onChange, onRemove, onCreateType }) {
  const [adding, setAdding] = useState(false);
  const used = entry.allowances.map((l) => l.type_id);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
      {entry.allowances.map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <TypeSelect value={l.type_id} types={types} usedIds={used} disabled={locked} label={`Allowance type for ${who}`}
            onPick={(id) => id && onChange(l, { type_id: id })}
            onCreate={async (name) => { const t = await onCreateType(name); if (t) await onChange(l, { type_id: t.id }); return !!t; }} />
          <MoneyInput value={l.amount} disabled={locked} label={`${l.type_name} amount for ${who}`} onSave={(v) => onChange(l, { amount: v })} width="100px" />
          {!locked && (
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}
              aria-label={`Remove ${l.type_name} for ${who}`} onClick={() => onRemove(l)}>✕</button>
          )}
        </div>
      ))}
      {!locked && (adding ? (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <TypeSelect value="" types={types} usedIds={used} label={`New allowance type for ${who}`}
            onPick={async (id) => { if (id) { setAdding(false); await onAdd(id); } }}
            onCreate={async (name) => { const t = await onCreateType(name); if (t) { setAdding(false); await onAdd(t.id); } return !!t; }} />
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} aria-label="Cancel" onClick={() => setAdding(false)}>✕</button>
        </div>
      ) : (
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => setAdding(true)}>
          <Plus className="icon" /> Add allowance
        </button>
      ))}
      {entry.allowances.length > 0 && (
        <div style={{ fontSize: '13px', fontWeight: 700, borderTop: '1px solid var(--border-light)', paddingTop: '6px', alignSelf: 'stretch', textAlign: 'right' }}>
          Total allowances: {num(entry.allowance_total)}
        </div>
      )}
    </div>
  );
}

export default function SalaryPortal({ showToast, onBack }) {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [filters, setFilters] = useState({ agent_id: '', type_id: '', status: '' });
  const [agents, setAgents] = useState([]);
  const [data, setData] = useState(null); // { entries, types }
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const qs = new URLSearchParams();
      if (month) qs.set('month', month);
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setData(await api.get(`/salary/entries?${qs}`));
    } catch (err) {
      setLoadError(err.message);
    }
  }, [month, filters]);

  useEffect(() => {
    api.get('/users/agents').then(setAgents).catch((err) => setLoadError(err.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const types = data?.types || [];
  const entries = data?.entries || [];
  const replace = (entry) => setData((d) => ({ ...d, entries: d.entries.map((e) => (e.id === entry.id ? entry : e)) }));

  const addTypeByName = async (name) => {
    try {
      const t = await api.post('/salary/types', { name });
      setData((d) => ({ ...d, types: d.types.some((x) => x.id === t.id) ? d.types : [...d.types, t] }));
      showToast(`Added "${t.name}".`);
      return t;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const startDraft = () => setDraft({
    entry_date: month === todayStr().slice(0, 7) ? todayStr() : `${month}-01`,
    agent_id: filters.agent_id, basic_salary: 0, advance: 0, deduction: 0, allowances: [], allowance_total: 0
  });

  // Edit a saved row.
  const patchEntry = async (entry, patch) => {
    try {
      const res = await api.patch(`/salary/entries/${entry.id}`, patch);
      replace(res.entry);
    } catch (err) {
      showToast(err.message, 'error');
      load(); // put the row back to what is saved
    }
  };

  // Allowance lines of a saved row.
  const lineCall = async (entry, call) => {
    try {
      const res = await call();
      replace(res.entry);
    } catch (err) {
      showToast(err.message, 'error');
      load();
    }
  };
  const addLine = (entry, type_id) => lineCall(entry, () => api.post(`/salary/entries/${entry.id}/allowances`, { type_id, amount: 0 }));
  const changeLine = (entry, line, patch) => lineCall(entry, () => api.patch(`/salary/entries/${entry.id}/allowances/${line.id}`, patch));
  const removeLine = (entry, line) => lineCall(entry, () => api.delete(`/salary/entries/${entry.id}/allowances/${line.id}`));

  // Edit the new row; it is saved the moment an employee is chosen.
  const patchDraft = async (patch) => {
    const next = { ...draft, ...patch };
    if (!next.agent_id) return setDraft(next);
    try {
      const res = await api.post('/salary/entries', next);
      setData((d) => ({ ...d, entries: [...d.entries, res.entry] }));
      setDraft(null);
    } catch (err) {
      showToast(err.message, 'error');
      setDraft(next);
    }
  };

  const togglePaid = async (e, paid) => {
    const text = paid
      ? `Mark ${e.agent_name} as paid?\n\nNet ${money(e.net)}. The row will be locked.`
      : `Undo Paid for ${e.agent_name}?\n\nThe row becomes editable again.`;
    if (!window.confirm(text)) return;
    setBusy(e.id);
    try {
      const res = await api.patch(`/salary/entries/${e.id}`, { paid });
      replace(res.entry);
      showToast(paid ? `${e.agent_name} marked as paid.` : 'Paid undone.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete this row?\n\n${e.agent_name} — ${fmtDate(e.entry_date)} — net ${money(e.net)}`)) return;
    setBusy(e.id);
    try {
      await api.delete(`/salary/entries/${e.id}`);
      setData((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id) }));
      showToast('Row deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const sum = (k, list = entries) => list.reduce((s, e) => s + (+e[k] || 0), 0);
  const paidNet = entries.filter((e) => e.status === 'paid').reduce((s, e) => s + e.net, 0);
  const unpaidNet = entries.filter((e) => e.status !== 'paid').reduce((s, e) => s + e.net, 0);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  // One row, saved or draft. `rec` is the data, `locked` blocks editing.
  const row = (rec, { isDraft }) => {
    const locked = !isDraft && rec.status === 'paid';
    const edit = (patch) => (isDraft ? patchDraft(patch) : patchEntry(rec, patch));
    const who = rec.agent_name || 'new row';
    return (
      <tr key={isDraft ? 'draft' : rec.id}>
        <td style={{ ...td, ...left }}>
          <input type="date" className="glass-input" aria-label={`Date for ${who}`} disabled={locked} value={rec.entry_date || ''}
            onChange={(e) => e.target.value && edit({ entry_date: e.target.value })} style={{ padding: '6px 8px' }} />
        </td>
        <td style={{ ...td, ...left }}>
          <select className="glass-input" aria-label="Employee name" disabled={locked} value={rec.agent_id || ''}
            onChange={(e) => e.target.value && edit({ agent_id: e.target.value })} style={{ width: '170px', padding: '6px 8px' }}>
            <option value="">Choose employee…</option>
            {agents.filter((a) => !isDraft || !entries.some((e) => e.agent_id === a.id && e.status !== 'paid')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </td>
        <td style={td}><MoneyInput value={rec.basic_salary} disabled={locked} label={`Basic salary for ${who}`} onSave={(v) => edit({ basic_salary: v })} /></td>
        <td style={td}>
          {isDraft ? (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Choose the employee, then add allowances</span>
          ) : (
            <AllowanceLines entry={rec} types={types} locked={locked} who={who}
              onAdd={(typeId) => addLine(rec, typeId)} onChange={(l, patch) => changeLine(rec, l, patch)} onRemove={(l) => removeLine(rec, l)} onCreateType={addTypeByName} />
          )}
        </td>
        <td style={td}><MoneyInput value={rec.advance} disabled={locked} label={`Advance for ${who}`} onSave={(v) => edit({ advance: v })} /></td>
        <td style={td}><MoneyInput value={rec.deduction} disabled={locked} label={`Deductions for ${who}`} onSave={(v) => edit({ deduction: v })} /></td>
        <td style={{ ...td, fontWeight: 700, paddingTop: '14px' }}>{netOf(rec) ? num(netOf(rec)) : '–'}</td>
        <td style={td}>
          {isDraft ? (
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => setDraft(null)}>Cancel</button>
          ) : (
            <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
              {locked ? (
                <>
                  <span className="badge badge-paid">Paid {fmtDate(rec.paid_on)}</span>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} disabled={busy === rec.id}
                    aria-label={`Undo paid for ${who}`} onClick={() => togglePaid(rec, false)}><Undo2 className="icon" /> Undo</button>
                </>
              ) : (
                <>
                  <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '8px 14px', fontSize: '13px' }}
                    disabled={!(rec.net > 0) || busy === rec.id} aria-label={`Mark ${who} as paid`} onClick={() => togglePaid(rec, true)}>
                    <Check className="icon" /> Paid
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px' }} disabled={busy === rec.id}
                    aria-label={`Delete row for ${who}`} onClick={() => remove(rec)}><Trash2 className="icon" /></button>
                </>
              )}
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        {onBack && (
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={onBack}>
            <ArrowLeft className="icon" /> Main Selector
          </button>
        )}
        <div>
          <h2 style={{ fontSize: '28px', margin: 0 }}>Monthly Salary Table</h2>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>One row per employee: add as many allowances as needed and the total updates. Press Paid when you give it.</span>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>
          Could not load the salary table: {loadError}
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>If this is the first time, the database setup for the Salary portal may not have been run yet.</div>
        </div>
      )}

      {/* Header: month, employee, allowance type and status selectors */}
      <section className="glass-card" style={{ padding: '14px 18px', display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="sal-month" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>Month</label>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 10px' }} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="icon" /></button>
            <input id="sal-month" type="month" className="glass-input" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: '160px' }} />
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 10px' }} aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="icon" /></button>
          </div>
        </div>
        <div>
          <label htmlFor="sal-f-agent" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>Employee</label>
          <select id="sal-f-agent" className="glass-input" value={filters.agent_id} onChange={(e) => setFilter('agent_id', e.target.value)}>
            <option value="">All employees</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sal-f-type" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>Allowance type</label>
          <select id="sal-f-type" className="glass-input" value={filters.type_id} onChange={(e) => setFilter('type_id', e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sal-f-status" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>Status</label>
          <select id="sal-f-status" className="glass-input" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All</option>
            <option value="pending">Not paid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 14px', fontSize: '13px' }} onClick={() => setMonth('')} disabled={!month}>All time</button>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="kpi-card kpi-card-emerald"><span className="kpi-lbl">Paid{month ? ` (${monthLabel(month)})` : ''}</span><h3 className="kpi-val">{data ? money(paidNet) : '…'}</h3></div>
        <div className="kpi-card kpi-card-rose"><span className="kpi-lbl">Not paid yet</span><h3 className="kpi-val">{data ? money(unpaidNet) : '…'}</h3></div>
      </div>

      {data === null ? (
        <div className="glass-card" style={{ padding: '24px' }}>{loadError ? '' : 'Loading…'}</div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '960px' }}>
            <thead>
              <tr>
                <th style={{ ...th, ...left }}>Date</th>
                <th style={{ ...th, ...left }}>Employee Name</th>
                <th style={th}>Basic Salary</th>
                <th style={th}>Allowances</th>
                <th style={th}>Advance</th>
                <th style={th}>Deductions</th>
                <th style={th}>Net Salary</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => row(e, { isDraft: false }))}
              {draft && row({ ...draft, net: netOf(draft) }, { isDraft: true })}
              {entries.length === 0 && !draft && (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)', padding: '28px' }}>No rows {month ? 'for this month' : ''} yet. Tap "Add row" below.</td></tr>
              )}
              <tr>
                <td style={{ ...td, borderBottom: 'none' }} />
                <td style={{ ...td, ...left, fontWeight: 700, borderBottom: 'none' }}>Total</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(sum('basic_salary'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(sum('allowance_total'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(sum('advance'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(sum('deduction'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(sum('net'))}</td>
                <td style={{ ...td, borderBottom: 'none' }} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div>
        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '12px 20px' }} disabled={!!draft || data === null} onClick={startDraft}>
          <Plus className="icon" /> Add row
        </button>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        Net Salary = basic salary + allowances + advance − deductions. To recover an advance later, type it in that employee's Deductions. A new row is saved as soon as you choose the employee. For money an agent spent themselves (for example petrol), add that allowance on their row and press Paid when you give it back.
      </div>
    </div>
  );
}
