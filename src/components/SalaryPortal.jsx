'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/apiClient.js';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Landmark, Plus, Trash2, Undo2 } from 'lucide-react';

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

const th = { padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' };
const td = { padding: '8px 12px', textAlign: 'right', fontSize: '14px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top' };
const left = { textAlign: 'left' };
// Sticky edges keep the employee, status, Net and Paid button in view while the middle scrolls.
const stickyLeft = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-secondary)', boxShadow: '1px 0 0 var(--border-light)' };
const stickyRight = { position: 'sticky', right: 0, zIndex: 1, background: 'var(--bg-secondary)', boxShadow: '-1px 0 0 var(--border-light)' };
const tabular = { fontVariantNumeric: 'tabular-nums' };

// True on phone/tablet widths: sticky edges are dropped and the status block moves into the first cell.
function useCompact(max = 899) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${max}px)`);
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [max]);
  return compact;
}

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

// The Allowances cell. Paid rows show plain text; open rows show one editable line per allowance
// (type + amount), "+ Add allowance" for another, and the running total underneath.
function AllowanceLines({ entry, types, locked, who, onAdd, onChange, onRemove, onCreateType }) {
  const [adding, setAdding] = useState(false);
  const used = entry.allowances.map((l) => l.type_id);

  if (locked) {
    if (!entry.allowances.length) return <span>–</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
        {entry.allowances.map((l) => (
          <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span>{l.type_name}</span><span style={tabular}>{num(l.amount)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontWeight: 700, borderTop: '1px solid var(--border-light)', paddingTop: '4px' }}>
          <span>Total allowances</span><span style={tabular}>{num(entry.allowance_total)}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
      {entry.allowances.map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <TypeSelect value={l.type_id} types={types} usedIds={used} label={`Allowance type for ${who}`}
            onPick={(id) => id && onChange(l, { type_id: id })}
            onCreate={async (name) => { const t = await onCreateType(name); if (t) await onChange(l, { type_id: t.id }); return !!t; }} />
          <MoneyInput value={l.amount} label={`${l.type_name} amount for ${who}`} onSave={(v) => onChange(l, { amount: v })} width="100px" />
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}
            aria-label={`Remove ${l.type_name} for ${who}`} onClick={() => onRemove(l)}>✕</button>
        </div>
      ))}
      {adding ? (
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
      )}
      {entry.allowances.length > 0 && (
        <div style={{ fontSize: '13px', fontWeight: 700, borderTop: '1px solid var(--border-light)', paddingTop: '6px', alignSelf: 'stretch', textAlign: 'right' }}>
          Total allowances: {num(entry.allowance_total)}
        </div>
      )}
    </div>
  );
}

const BLANK_DETAILS = { basic_salary: '', bank_name: '', bank_branch: '', account_holder: '', account_number: '' };
const detailsFrom = (e) => (e ? {
  basic_salary: e.basic_salary ? String(e.basic_salary) : '', bank_name: e.bank_name || '', bank_branch: e.bank_branch || '',
  account_holder: e.account_holder || '', account_number: e.account_number || ''
} : BLANK_DETAILS);
const maskedAccount = (n) => (n ? `••••${String(n).slice(-4)}` : '');

// Popup to set an employee's basic salary (fills their first row each month) and bank details.
function EmployeeDetailsDialog({ employees, startId, ready, onClose, onSaved, showToast }) {
  const [id, setId] = useState(startId || '');
  const [form, setForm] = useState(() => detailsFrom(employees.find((e) => e.id === startId)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const emp = employees.find((e) => e.id === id);

  // Keyboard: Escape closes, Tab stays inside the popup, focus goes back to the opener on close.
  useEffect(() => {
    const first = box.current?.querySelector('select, input');
    first?.focus();
    const openerEl = opener.current;
    return () => openerEl?.focus?.();
  }, []);
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...box.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };

  const pick = (nextId) => { setId(nextId); setForm(detailsFrom(employees.find((e) => e.id === nextId))); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (!id) return setError('Choose the employee.');
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/salary/employees/${id}`, form);
      onSaved(res.employee);
      showToast(`Saved details for ${res.employee.name}.`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = { display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' };
  return (
    <div className="receipt-modal-overlay" onClick={onClose}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby="emp-dlg-title" className="glass-card" onKeyDown={onKeyDown} onSubmit={submit}
        style={{ maxWidth: '520px', width: '92%', padding: '24px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <h3 id="emp-dlg-title" style={{ fontSize: '20px', margin: 0 }}>Update employee details</h3>
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 14px', fontSize: '13px' }} onClick={onClose}>Close</button>
        </div>

        {!ready && (
          <div role="alert" style={{ fontSize: '13px', color: 'var(--accent-rose)' }}>
            The database setup for employee details has not been run yet (scripts/salary-portal.sql), so these cannot be saved.
          </div>
        )}
        {error && <div role="alert" style={{ fontSize: '14px', color: 'var(--accent-rose)' }}>{error}</div>}

        <div>
          <label htmlFor="emp-dlg-employee" style={label}>Employee *</label>
          <select id="emp-dlg-employee" className="glass-input" value={id} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <fieldset disabled={!id} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label htmlFor="emp-dlg-basic" style={label}>Basic salary (LKR per month)</label>
            <input id="emp-dlg-basic" className="glass-input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="e.g. 25000"
              value={form.basic_salary} onChange={(e) => set('basic_salary', e.target.value)} />
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Fills the Basic Salary of this employee's first row each month. You can still change it in the row.</div>
          </div>
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '12px', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Landmark className="icon" aria-hidden="true" /> Bank details
          </div>
          <div>
            <label htmlFor="emp-dlg-holder" style={label}>Account holder name</label>
            <input id="emp-dlg-holder" className="glass-input" maxLength={150} autoComplete="off" value={form.account_holder} onChange={(e) => set('account_holder', e.target.value)} />
          </div>
          <div>
            <label htmlFor="emp-dlg-number" style={label}>Account number</label>
            <input id="emp-dlg-number" className="glass-input" maxLength={40} autoComplete="off" inputMode="numeric" value={form.account_number} onChange={(e) => set('account_number', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <div>
              <label htmlFor="emp-dlg-bank" style={label}>Bank</label>
              <input id="emp-dlg-bank" className="glass-input" maxLength={100} autoComplete="off" placeholder="e.g. Commercial Bank" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="emp-dlg-branch" style={label}>Branch</label>
              <input id="emp-dlg-branch" className="glass-input" maxLength={100} autoComplete="off" value={form.bank_branch} onChange={(e) => set('bank_branch', e.target.value)} />
            </div>
          </div>
        </fieldset>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 18px' }} onClick={onClose}>Cancel</button>
          <button type="submit" className="glass-btn glass-btn-emerald" style={{ padding: '10px 22px' }} disabled={saving || !id || !ready}>{saving ? 'Saving…' : `Save${emp ? ` for ${emp.name}` : ''}`}</button>
        </div>
      </form>
    </div>
  );
}

export default function SalaryPortal({ showToast, onBack }) {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [filters, setFilters] = useState({ agent_id: '', type_id: '', status: '' });
  const [agents, setAgents] = useState([]); // everyone who can be paid, with their saved details
  const [detailsReady, setDetailsReady] = useState(true);
  const [detailsFor, setDetailsFor] = useState(null); // null = closed, '' = open with no one chosen, id = open for that employee
  const [data, setData] = useState(null); // { entries, types }
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(null);
  const [save, setSave] = useState('idle'); // idle | saving | saved | error
  const inflight = useRef(0);
  const resetTimer = useRef(null);
  const compact = useCompact();

  // Wraps every save so the header can say Saving… / All changes saved / Could not save.
  const track = useCallback(async (fn) => {
    inflight.current += 1;
    clearTimeout(resetTimer.current);
    setSave('saving');
    let failed = false;
    try {
      return await fn();
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) {
        setSave(failed ? 'error' : 'saved');
        resetTimer.current = setTimeout(() => setSave('idle'), failed ? 8000 : 3000);
      }
    }
  }, []);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

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
    api.get('/salary/employees').then((r) => { setAgents(r.employees); setDetailsReady(r.detailsReady); }).catch((err) => setLoadError(err.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const types = data?.types || [];
  const entries = data?.entries || [];
  const employeeById = new Map(agents.map((a) => [a.id, a]));
  const savedDetails = (employee) => setAgents((list) => list.map((a) => (a.id === employee.id ? { ...a, ...employee } : a)));
  const replace = (entry) => setData((d) => ({ ...d, entries: d.entries.map((e) => (e.id === entry.id ? entry : e)) }));

  const addTypeByName = async (name) => {
    try {
      const t = await track(() => api.post('/salary/types', { name }));
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
    agent_id: filters.agent_id, allowances: [], allowance_total: 0
  });

  // Edit a saved row.
  const patchEntry = async (entry, patch) => {
    try {
      const res = await track(() => api.patch(`/salary/entries/${entry.id}`, patch));
      replace(res.entry);
    } catch (err) {
      showToast(err.message, 'error');
      load(); // put the row back to what is saved
    }
  };

  // Allowance lines of a saved row.
  const lineCall = async (call) => {
    try {
      const res = await track(call);
      replace(res.entry);
    } catch (err) {
      showToast(err.message, 'error');
      load();
    }
  };
  const addLine = (entry, type_id) => lineCall(() => api.post(`/salary/entries/${entry.id}/allowances`, { type_id, amount: 0 }));
  const changeLine = (entry, line, patch) => lineCall(() => api.patch(`/salary/entries/${entry.id}/allowances/${line.id}`, patch));
  const removeLine = (entry, line) => lineCall(() => api.delete(`/salary/entries/${entry.id}/allowances/${line.id}`));

  // Edit the new row; it is saved the moment an employee is chosen.
  const patchDraft = async (patch) => {
    const next = { ...draft, ...patch };
    if (!next.agent_id) return setDraft(next);
    try {
      const res = await track(() => api.post('/salary/entries', next));
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
      const res = await track(() => api.patch(`/salary/entries/${e.id}`, { paid }));
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
      await track(() => api.delete(`/salary/entries/${e.id}`));
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

  // Rows grouped by employee, each with its own totals.
  const groups = [...entries.reduce((m, e) => {
    const g = m.get(e.agent_id) || { id: e.agent_id, name: e.agent_name, rows: [] };
    g.rows.push(e);
    return m.set(e.agent_id, g);
  }, new Map()).values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({
    ...g,
    basic: sum('basic_salary', g.rows), allowance: sum('allowance_total', g.rows), advance: sum('advance', g.rows),
    deduction: sum('deduction', g.rows), net: sum('net', g.rows),
    paid: g.rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.net, 0),
    unpaid: g.rows.filter((r) => r.status !== 'paid').reduce((s, r) => s + r.net, 0)
  }));

  // Net amount and what can be done with the row (Paid / Undo / delete / cancel).
  const statusBlock = (rec, { isDraft, locked, who, align }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Net Salary</div>
      <div style={{ fontSize: '18px', fontWeight: 800, ...tabular }}>{netOf(rec) ? num(netOf(rec)) : '–'}</div>
      {isDraft ? (
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 12px', fontSize: '13px' }} onClick={() => setDraft(null)}>Cancel</button>
      ) : locked ? (
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 12px', fontSize: '13px' }} disabled={busy === rec.id}
          aria-label={`Undo paid for ${who}`} onClick={() => togglePaid(rec, false)}><Undo2 className="icon" /> Undo</button>
      ) : (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '10px 16px', fontSize: '13px' }}
            disabled={!(rec.net > 0) || busy === rec.id} aria-label={`Mark ${who} as paid`} onClick={() => togglePaid(rec, true)}>
            <Check className="icon" /> Paid
          </button>
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 12px', marginLeft: '6px' }} disabled={busy === rec.id}
            aria-label={`Delete row for ${who}`} onClick={() => remove(rec)}><Trash2 className="icon" /></button>
        </div>
      )}
    </div>
  );

  // One row, saved or draft. `rec` is the data; a paid row is locked and shown as plain text.
  const row = (rec, { isDraft }) => {
    const locked = !isDraft && rec.status === 'paid';
    const edit = (patch) => (isDraft ? patchDraft(patch) : patchEntry(rec, patch));
    const who = rec.agent_name || 'new row';
    const text = (v) => <span style={tabular}>{v ? num(v) : '–'}</span>;
    return (
      <tr key={isDraft ? 'draft' : rec.id}>
        <td style={{ ...td, ...left, ...(compact ? {} : stickyLeft), borderLeft: `4px solid ${locked ? 'var(--accent-emerald)' : 'transparent'}`, minWidth: '190px' }}>
          {locked ? (
            <strong style={{ fontSize: '15px' }}>{rec.agent_name}</strong>
          ) : (
            <select className="glass-input" aria-label="Employee name" value={rec.agent_id || ''}
              onChange={(e) => e.target.value && edit({ agent_id: e.target.value })} style={{ width: '170px', padding: '6px 8px' }}>
              <option value="">Choose employee…</option>
              {agents.filter((a) => !isDraft || !entries.some((e) => e.agent_id === a.id && e.status !== 'paid')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <div style={{ marginTop: '6px' }}>
            {isDraft ? <span className="badge badge-pending">New row</span>
              : locked ? <span className="badge badge-paid">Paid {fmtDate(rec.paid_on)}</span>
              : <span className="badge badge-pending">Not paid</span>}
          </div>
          {rec.agent_id && (
            <div style={{ marginTop: '6px' }}>
              <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}
                aria-label={`Employee details for ${who}`} onClick={() => setDetailsFor(rec.agent_id)}><Landmark className="icon" /> Details</button>
            </div>
          )}
          {compact && <div style={{ marginTop: '10px' }}>{statusBlock(rec, { isDraft, locked, who, align: 'left' })}</div>}
        </td>
        <td style={{ ...td, ...left }}>
          {locked ? <span>{fmtDate(rec.entry_date)}</span> : (
            <input type="date" className="glass-input" aria-label={`Date for ${who}`} value={rec.entry_date || ''}
              onChange={(e) => e.target.value && edit({ entry_date: e.target.value })} style={{ padding: '6px 8px' }} />
          )}
        </td>
        <td style={td}>{locked ? text(rec.basic_salary) : <MoneyInput value={rec.basic_salary} label={`Basic salary for ${who}`} onSave={(v) => edit({ basic_salary: v })} />}</td>
        <td style={td}>
          {isDraft ? (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Choose the employee, then add allowances</span>
          ) : (
            <AllowanceLines entry={rec} types={types} locked={locked} who={who}
              onAdd={(typeId) => addLine(rec, typeId)} onChange={(l, patch) => changeLine(rec, l, patch)} onRemove={(l) => removeLine(rec, l)} onCreateType={addTypeByName} />
          )}
        </td>
        <td style={td}>{locked ? text(rec.advance) : <MoneyInput value={rec.advance} label={`Advance for ${who}`} onSave={(v) => edit({ advance: v })} />}</td>
        <td style={td}>{locked ? text(rec.deduction) : <MoneyInput value={rec.deduction} label={`Deductions for ${who}`} onSave={(v) => edit({ deduction: v })} />}</td>
        {!compact && <td style={{ ...td, ...stickyRight }}>{statusBlock(rec, { isDraft, locked, who, align: 'right' })}</td>}
      </tr>
    );
  };

  // Subtotal line under an employee who has more than one row.
  const subtotalRow = (g) => (
    <tr key={`sub-${g.id}`} style={{ background: 'var(--bg-tertiary)' }}>
      <td style={{ ...td, ...left, ...(compact ? {} : { ...stickyLeft, background: 'var(--bg-tertiary)' }), fontWeight: 700 }}>
        {g.name} — total
        <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>Paid {num(g.paid)} · Not paid {num(g.unpaid)}</div>
      </td>
      <td style={td} />
      <td style={{ ...td, fontWeight: 700, ...tabular }}>{num(g.basic)}</td>
      <td style={{ ...td, fontWeight: 700, ...tabular }}>{num(g.allowance)}</td>
      <td style={{ ...td, fontWeight: 700, ...tabular }}>{num(g.advance)}</td>
      <td style={{ ...td, fontWeight: 700, ...tabular }}>{num(g.deduction)}</td>
      {!compact ? <td style={{ ...td, ...stickyRight, background: 'var(--bg-tertiary)', fontWeight: 800, fontSize: '16px', ...tabular }}>{num(g.net)}</td> : null}
    </tr>
  );

  const saveText = save === 'saving' ? 'Saving…' : save === 'saved' ? '✓ All changes saved' : save === 'error' ? 'Could not save — see the message' : '';
  const colCount = compact ? 6 : 7;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
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
        <span role="status" aria-live="polite" style={{ fontSize: '13px', fontWeight: 600, minHeight: '20px', color: save === 'error' ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>{saveText}</span>
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
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '10px 14px', fontSize: '13px', marginLeft: 'auto' }} onClick={() => setDetailsFor('')}>
          <Landmark className="icon" /> Employee details
        </button>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="kpi-card kpi-card-emerald"><span className="kpi-lbl">Paid{month ? ` (${monthLabel(month)})` : ''}</span><h3 className="kpi-val">{data ? money(paidNet) : '…'}</h3></div>
        <div className="kpi-card kpi-card-rose"><span className="kpi-lbl">Not paid yet</span><h3 className="kpi-val">{data ? money(unpaidNet) : '…'}</h3></div>
      </div>

      {/* Totals for each employee, across all their rows */}
      {data && groups.length > 0 && (
        <details open className="glass-card" style={{ padding: '14px 18px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>Totals by employee ({groups.length})</summary>
          <div style={{ overflowX: 'auto', marginTop: '10px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '860px' }}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Totals for each employee</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ ...th, ...left }}>Employee</th>
                  <th scope="col" style={th}>Basic</th>
                  <th scope="col" style={th}>Allowances</th>
                  <th scope="col" style={th}>Advance</th>
                  <th scope="col" style={th}>Deductions</th>
                  <th scope="col" style={th}>Net total</th>
                  <th scope="col" style={th}>Paid</th>
                  <th scope="col" style={th}>Not paid</th>
                  <th scope="col" style={{ ...th, ...left }}>Bank details</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <th scope="row" style={{ ...td, ...left, fontWeight: 700 }}>{g.name}{g.rows.length > 1 ? ` (${g.rows.length} rows)` : ''}</th>
                    <td style={{ ...td, ...tabular }}>{num(g.basic)}</td>
                    <td style={{ ...td, ...tabular }}>{num(g.allowance)}</td>
                    <td style={{ ...td, ...tabular }}>{num(g.advance)}</td>
                    <td style={{ ...td, ...tabular }}>{num(g.deduction)}</td>
                    <td style={{ ...td, fontWeight: 700, ...tabular }}>{num(g.net)}</td>
                    <td style={{ ...td, ...tabular }}>{num(g.paid)}</td>
                    <td style={{ ...td, ...tabular, color: g.unpaid > 0 ? 'var(--accent-rose)' : undefined, fontWeight: g.unpaid > 0 ? 700 : 400 }}>{num(g.unpaid)}</td>
                    <td style={{ ...td, ...left, whiteSpace: 'normal' }}>
                      {(() => {
                        const d = employeeById.get(g.id);
                        const hasBank = d && (d.bank_name || d.account_number);
                        return (
                          <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: hasBank ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {hasBank ? [d.bank_name, maskedAccount(d.account_number)].filter(Boolean).join(' ') : 'Not added'}
                            </span>
                            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}
                              aria-label={`Employee details for ${g.name}`} onClick={() => setDetailsFor(g.id)}>{hasBank ? 'Edit' : 'Add'}</button>
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {data === null ? (
        <div className="glass-card" style={{ padding: '24px' }}>{loadError ? '' : 'Loading…'}</div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: compact ? '760px' : '980px' }}>
            <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Monthly salary table, one group of rows per employee</caption>
            <thead>
              <tr>
                <th scope="col" style={{ ...th, ...left, ...(compact ? {} : stickyLeft) }}>Employee Name</th>
                <th scope="col" style={{ ...th, ...left }}>Date</th>
                <th scope="col" style={th}>Basic Salary</th>
                <th scope="col" style={th}>Allowances</th>
                <th scope="col" style={th}>Advance</th>
                <th scope="col" style={th}>Deductions</th>
                {!compact && <th scope="col" style={{ ...th, ...stickyRight }}>Net Salary / Paid</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.id}>
                  {g.rows.map((e) => row(e, { isDraft: false }))}
                  {g.rows.length > 1 && subtotalRow(g)}
                </React.Fragment>
              ))}
              {draft && row({ ...draft, net: netOf(draft) }, { isDraft: true })}
              {entries.length === 0 && !draft && (
                <tr><td colSpan={colCount} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)', padding: '28px' }}>No rows {month ? 'for this month' : ''} yet. Tap "Add row" below.</td></tr>
              )}
              <tr>
                <td style={{ ...td, ...left, ...(compact ? {} : stickyLeft), fontWeight: 800, borderBottom: 'none' }}>All employees — total</td>
                <td style={{ ...td, borderBottom: 'none' }} />
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none', ...tabular }}>{num(sum('basic_salary'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none', ...tabular }}>{num(sum('allowance_total'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none', ...tabular }}>{num(sum('advance'))}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none', ...tabular }}>{num(sum('deduction'))}</td>
                {!compact && <td style={{ ...td, ...stickyRight, fontWeight: 800, fontSize: '16px', borderBottom: 'none', ...tabular }}>{num(sum('net'))}</td>}
              </tr>
              {compact && (
                <tr><td colSpan={colCount} style={{ ...td, ...left, fontWeight: 800, borderBottom: 'none' }}>Net total: {num(sum('net'))}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '12px 20px' }} disabled={!!draft || data === null} onClick={startDraft}>
          <Plus className="icon" /> Add row
        </button>
        {draft && <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>Choose the employee in the new row to save it.</span>}
      </div>
      {detailsFor !== null && (
        <EmployeeDetailsDialog employees={agents} startId={detailsFor} ready={detailsReady} showToast={showToast}
          onClose={() => setDetailsFor(null)} onSaved={savedDetails} />
      )}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        Net Salary = basic salary + allowances + advance − deductions. To recover an advance later, type it in that employee's Deductions. A new row is saved as soon as you choose the employee. For money an agent spent themselves (for example petrol), add that allowance on their row and press Paid when you give it back.
      </div>
    </div>
  );
}
