'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Plus, Undo2 } from 'lucide-react';

const num = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' }).slice(0, 7);
const shiftMonth = (m, by) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const KIND_LABEL = { salary: 'Salary', allowance: 'Allowance', deduction: 'Deduction' };
const KIND_COLOR = { salary: 'var(--accent-blue)', allowance: 'var(--accent-emerald)', deduction: 'var(--accent-rose)' };

const netOf = (row, types) => types.reduce((s, t) => {
  const v = row.items[t.id] || 0;
  return s + (t.kind === 'deduction' ? -v : v);
}, 0);

const th = { padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-light)' };
const td = { padding: '8px 12px', textAlign: 'right', fontSize: '14px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-light)' };
const stickyLeft = { position: 'sticky', left: 0, background: 'var(--bg-secondary)', textAlign: 'left', zIndex: 1 };

// A number cell you type into. Saves when you leave it (or press Enter), only if it changed.
function Cell({ value, disabled, label, onSave }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  useEffect(() => { setDraft(value ? String(value) : ''); }, [value]);
  const commit = () => {
    const next = draft === '' ? 0 : parseFloat(draft);
    if (Number.isNaN(next)) return setDraft(value ? String(value) : '');
    if (next !== (value || 0)) onSave(next);
  };
  return (
    <input type="number" min="0" step="0.01" inputMode="decimal" className="glass-input" aria-label={label}
      value={draft} placeholder="–" disabled={disabled}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(value ? String(value) : ''); e.currentTarget.blur(); } }}
      style={{ width: '110px', textAlign: 'right', padding: '6px 8px' }} />
  );
}

export default function SalaryPortal({ showToast, onBack }) {
  const [month, setMonth] = useState(thisMonth());
  const [sheet, setSheet] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | pending | paid
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newCol, setNewCol] = useState({ name: '', kind: 'allowance' });
  const [addingBusy, setAddingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setSheet(await api.get(`/salary/sheet?month=${month}`));
    } catch (err) {
      setLoadError(err.message);
    }
  }, [month]);
  useEffect(() => { setSheet(null); load(); }, [load]);

  const replaceRow = (row) => setSheet((s) => ({ ...s, rows: s.rows.map((r) => (r.agent_id === row.agent_id ? row : r)) }));

  const saveCell = async (row, type, amount) => {
    try {
      const res = await api.put('/salary/sheet', { agent_id: row.agent_id, month, type_id: type.id, amount });
      replaceRow(res.row);
    } catch (err) {
      showToast(err.message, 'error');
      load(); // put the cell back to what is saved
    }
  };

  const togglePaid = async (row, paid) => {
    const text = paid
      ? `Mark ${row.agent_name} as paid for ${monthLabel(month)}?\n\nNet ${money(netOf(row, sheet.types))}. The row will be locked.`
      : `Undo Paid for ${row.agent_name}?\n\nThe row becomes editable again.`;
    if (!window.confirm(text)) return;
    setBusy(row.agent_id);
    try {
      const res = await api.patch('/salary/sheet', { agent_id: row.agent_id, month, paid });
      replaceRow(res.row);
      showToast(paid ? `${row.agent_name} marked as paid.` : 'Paid undone.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addColumn = async (e) => {
    e.preventDefault();
    if (!newCol.name.trim()) return;
    setAddingBusy(true);
    try {
      await api.post('/salary/types', newCol);
      showToast(`Added "${newCol.name.trim()}".`);
      setNewCol({ name: '', kind: 'allowance' });
      setAdding(false);
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAddingBusy(false);
    }
  };

  const types = sheet?.types || [];
  const rows = (sheet?.rows || []).filter((r) => statusFilter === 'all' || (statusFilter === 'paid' ? r.status === 'paid' : r.status !== 'paid'));
  const colTotal = (t) => rows.reduce((s, r) => s + (r.items[t.id] || 0), 0);
  const netTotal = rows.reduce((s, r) => s + netOf(r, types), 0);
  const allRows = sheet?.rows || [];
  const paidNet = allRows.filter((r) => r.status === 'paid').reduce((s, r) => s + netOf(r, types), 0);
  const unpaidNet = allRows.filter((r) => r.status !== 'paid').reduce((s, r) => s + netOf(r, types), 0);

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
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tap a cell to type an amount. Press Paid when you give it.</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 10px' }} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="icon" /></button>
          <input type="month" className="glass-input" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: '170px' }} />
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 10px' }} aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="icon" /></button>
        </div>
      </div>

      {loadError && <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>Could not load: {loadError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="kpi-card kpi-card-emerald"><span className="kpi-lbl">Paid ({monthLabel(month)})</span><h3 className="kpi-val">{sheet ? money(paidNet) : '…'}</h3></div>
        <div className="kpi-card kpi-card-rose"><span className="kpi-lbl">Not paid yet</span><h3 className="kpi-val">{sheet ? money(unpaidNet) : '…'}</h3></div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div role="group" aria-label="Filter rows" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[['all', 'All'], ['pending', 'Not paid'], ['paid', 'Paid']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={statusFilter === k}
              className={`glass-btn ${statusFilter === k ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
              style={{ padding: '8px 14px', fontSize: '13px' }} onClick={() => setStatusFilter(k)}>{l}</button>
          ))}
        </div>
        {!adding ? (
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px', fontSize: '13px' }} onClick={() => setAdding(true)}>
            <Plus className="icon" /> Add column
          </button>
        ) : (
          <form onSubmit={addColumn} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="glass-input" aria-label="New column name" placeholder="e.g. Phone Allowance" maxLength={80} autoFocus
              value={newCol.name} onChange={(e) => setNewCol((c) => ({ ...c, name: e.target.value }))} style={{ width: '200px' }} />
            <select className="glass-input" aria-label="Column type" value={newCol.kind} onChange={(e) => setNewCol((c) => ({ ...c, kind: e.target.value }))}>
              <option value="allowance">Allowance (adds)</option>
              <option value="deduction">Deduction (takes off)</option>
            </select>
            <button type="submit" className="glass-btn glass-btn-emerald" style={{ padding: '8px 14px', fontSize: '13px' }} disabled={addingBusy || !newCol.name.trim()}>Add</button>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px', fontSize: '13px' }} onClick={() => setAdding(false)}>Cancel</button>
          </form>
        )}
      </div>

      {sheet === null ? (
        <div className="glass-card" style={{ padding: '24px' }}>Loading…</div>
      ) : sheet.rows.length === 0 ? (
        <div className="glass-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No agents yet. Add agents in Admin Tools and they will appear here.
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyLeft }}>Employee</th>
                {types.map((t) => (
                  <th key={t.id} style={th}>
                    {t.name}
                    <div style={{ fontSize: '10px', fontWeight: 600, color: KIND_COLOR[t.kind] }}>{KIND_LABEL[t.kind]}</div>
                  </th>
                ))}
                <th style={th}>Net Salary</th>
                <th style={th}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const paid = r.status === 'paid';
                const net = netOf(r, types);
                const hasAny = Object.keys(r.items).length > 0;
                return (
                  <tr key={r.agent_id}>
                    <td style={{ ...td, ...stickyLeft, fontWeight: 600 }}>{r.agent_name}</td>
                    {types.map((t) => (
                      <td key={t.id} style={td}>
                        <Cell value={r.items[t.id]} disabled={paid} label={`${t.name} for ${r.agent_name}`} onSave={(v) => saveCell(r, t, v)} />
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 700 }}>{hasAny ? num(net) : '–'}</td>
                    <td style={td}>
                      {paid ? (
                        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <span className="badge badge-paid">Paid {fmtDate(r.paid_on)}</span>
                          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} disabled={busy === r.agent_id}
                            aria-label={`Undo paid for ${r.agent_name}`} onClick={() => togglePaid(r, false)}><Undo2 className="icon" /> Undo</button>
                        </span>
                      ) : (
                        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '8px 14px', fontSize: '13px' }}
                          disabled={!hasAny || busy === r.agent_id} aria-label={`Mark ${r.agent_name} as paid`} onClick={() => togglePaid(r, true)}>
                          <Check className="icon" /> Paid
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={types.length + 3} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>No rows match this filter.</td></tr>
              )}
              <tr>
                <td style={{ ...td, ...stickyLeft, fontWeight: 700, borderBottom: 'none' }}>Total</td>
                {types.map((t) => <td key={t.id} style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(colTotal(t))}</td>)}
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{num(netTotal)}</td>
                <td style={{ ...td, borderBottom: 'none' }} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        Net Salary = salary + allowances − deductions. For money an agent spent themselves (for example petrol), type it in their row and press Paid when you give it back.
      </div>
    </div>
  );
}
