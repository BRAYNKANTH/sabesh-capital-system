'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/apiClient.js';
import { appendCompressedPhotos } from '@/lib/clientImageCompress.js';
import { calculateInterestPerPeriod } from '@/lib/services/loanMath.js';
import { addInterval } from '@/lib/loanSchedule.js';
import { TypedDateInput } from './TypedDateInput.jsx';
import { PawnTicket } from './PawnTicket.jsx';
import {
  Gem, Car, ArrowLeft, Plus, Printer, Search, TriangleAlert, Check, X, Camera,
  Gavel, CalendarPlus, RotateCcw, Package
} from 'lucide-react';

const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' }) : '-');
const newKey = () => `pawn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const EMPTY_FORM = {
  customer_name: '', father_husband_name: '', address: '', nic_number: '', mobile: '', occupation: '',
  monthly_income: '', reference_name: '', reference_phone: '',
  pawn_type: 'gold', item_description: '', make_model: '', registration_serial: '',
  gold_weight_grams: '', gold_karat: '', estimated_value: '', storage_location: '',
  item_photos: [], document_photos: [],
  principal_amount: '', interest_rate: '', interest_type: 'monthly', period_months: '1', start_date: '', notes: ''
};

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'forfeitable', label: 'Ready to forfeit' },
  { key: 'redeemed', label: 'Redeemed' },
  { key: 'forfeited', label: 'Forfeited' },
  { key: 'all', label: 'All' }
];

function StatusBadge({ loan }) {
  if (loan.status === 'forfeited') return <span className="badge badge-defaulted">Forfeited</span>;
  if (loan.status === 'redeemed') {
    return <span className="badge badge-paid">{loan.item_returned_at ? 'Redeemed — item returned' : 'Redeemed — return item'}</span>;
  }
  if (loan.can_forfeit) return <span className="badge badge-defaulted">Ready to forfeit</span>;
  if (loan.is_overdue) return <span className="badge badge-pending">{loan.days_overdue} day{loan.days_overdue === 1 ? '' : 's'} overdue</span>;
  return <span className="badge badge-active">Active</span>;
}

function Field({ id, label, children, hint }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '16px' };

function PhotoPicker({ id, label, photos, onAdd, onRemove }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</label>
      <input id={id} type="file" accept="image/*" multiple className="glass-input" onChange={onAdd} />
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          {photos.map((src, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={src} alt={`${label} ${i + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-light)' }} />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onRemove(i)}
                style={{ position: 'absolute', top: '-8px', right: '-8px', width: '24px', height: '24px', borderRadius: '50%', border: 'none', background: 'var(--accent-rose)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X style={{ width: '14px', height: '14px' }} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Up to 4 photos.</div>
    </div>
  );
}

// A simple accessible dialog: Escape closes it, focus starts inside it.
function Dialog({ title, onClose, children, maxWidth = '520px' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="receipt-modal-overlay" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="glass-card"
        style={{ maxWidth, width: '92%', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
          <h3 style={{ fontSize: '20px', margin: 0 }}>{title}</h3>
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 14px', fontSize: '13px' }} onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PawnPortal({ orgName, showToast, onBack }) {
  const [screen, setScreen] = useState('list'); // list | new | detail
  const [summary, setSummary] = useState(null);
  const [loans, setLoans] = useState(null);
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const loadList = useCallback(async () => {
    setLoadError('');
    try {
      const [s, l] = await Promise.all([api.get('/pawn/summary'), api.get('/pawn/loans')]);
      setSummary(s);
      setLoans(l);
    } catch (err) {
      setLoadError(err.message);
      setLoans((prev) => prev || []);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    try {
      setDetail(await api.get(`/pawn/loans/${id}`));
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (screen === 'detail' && selectedId) loadDetail(selectedId); }, [screen, selectedId, loadDetail]);

  const openLoan = (id) => { setDetail(null); setSelectedId(id); setScreen('detail'); window.scrollTo?.({ top: 0 }); };
  const backToList = () => { setScreen('list'); setSelectedId(null); setDetail(null); loadList(); };

  if (screen === 'new') {
    return <NewPawnForm onCancel={() => setScreen('list')} showToast={showToast} onCreated={(loan) => { loadList(); openLoan(loan.id); }} />;
  }
  if (screen === 'detail') {
    return <PawnDetail data={detail} orgName={orgName} showToast={showToast} onBack={backToList} onChanged={() => { loadDetail(selectedId); loadList(); }} />;
  }

  const matches = (l) => {
    if (filter === 'active') return l.status === 'active';
    if (filter === 'overdue') return l.status === 'active' && l.is_overdue;
    if (filter === 'forfeitable') return l.status === 'active' && l.can_forfeit;
    if (filter === 'redeemed') return l.status === 'redeemed';
    if (filter === 'forfeited') return l.status === 'forfeited';
    return true;
  };
  const q = search.trim().toLowerCase();
  const shown = (loans || []).filter(matches).filter((l) => !q || [l.customer_name, l.nic_number, l.mobile, l.reference_number, l.item_description].some((v) => (v || '').toLowerCase().includes(q)));
  const c = summary?.counts;
  const t = summary?.totals;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {onBack && (
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={onBack}>
              <ArrowLeft className="icon" /> Main Selector
            </button>
          )}
          <div>
            <h2 style={{ fontSize: '28px', margin: 0 }}>Pawn Loans</h2>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Vehicle and gold jewellery pawn loans</span>
          </div>
        </div>
        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '12px 20px' }} onClick={() => setScreen('new')}>
          <Plus className="icon" /> New Pawn Loan
        </button>
      </div>

      {loadError && <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>Could not load pawn loans: {loadError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="kpi-card kpi-card-blue"><span className="kpi-lbl">Active pawns</span><h3 className="kpi-val">{c ? c.active : '…'}</h3><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Estimated value held: {t ? money(t.estimatedValueHeld) : '…'}</span></div>
        <div className="kpi-card kpi-card-emerald"><span className="kpi-lbl">Principal outstanding</span><h3 className="kpi-val">{t ? money(t.principalOutstanding) : '…'}</h3><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Interest due: {t ? money(t.interestDue) : '…'}</span></div>
        <div className="kpi-card"><span className="kpi-lbl">Overdue</span><h3 className="kpi-val" style={{ color: c?.overdue ? 'var(--accent-rose)' : undefined }}>{c ? c.overdue : '…'}</h3><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c ? `${c.forfeitable} ready to forfeit` : ''}</span></div>
        <div className="kpi-card"><span className="kpi-lbl">Items to return</span><h3 className="kpi-val">{c ? c.awaitingReturn : '…'}</h3><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loans fully paid, item still held</span></div>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="group" aria-label="Filter pawn loans" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key}
              className={`glass-btn ${filter === f.key ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
              style={{ padding: '8px 14px', fontSize: '13px' }} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
          <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '16px', height: '16px', color: 'var(--text-muted)' }} aria-hidden="true" />
          <input type="search" className="glass-input" aria-label="Search pawn loans" placeholder="Search name, NIC, phone, ticket no. or item…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: '36px', width: '100%' }} />
        </div>
      </div>

      {loans === null ? (
        <div className="glass-card" style={{ padding: '24px' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className="glass-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          {(loans || []).length === 0 ? 'No pawn loans yet. Tap "New Pawn Loan" to record the first one.' : 'No pawn loans match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {shown.map((l) => (
            <button key={l.id} type="button" onClick={() => openLoan(l.id)} className="glass-card"
              style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr) auto', gap: '14px', alignItems: 'center', border: '1px solid var(--border-light)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {l.pawn_type === 'gold' ? <Gem className="icon" aria-label="Gold jewellery" /> : <Car className="icon" aria-label="Vehicle" />}
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.customer_name}</strong>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{l.reference_number} · {l.mobile}</div>
              </div>
              <div style={{ minWidth: 0, fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.item_description}</div>
              <div style={{ fontSize: '13px' }}>
                <div><strong>{money(l.total_outstanding)}</strong> owed</div>
                <div style={{ color: 'var(--text-secondary)' }}>Due {fmtDate(l.due_date)}</div>
              </div>
              <StatusBadge loan={l} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New pawn loan
// ---------------------------------------------------------------------------
function NewPawnForm({ onCancel, onCreated, showToast }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isGold = form.pawn_type === 'gold';

  const principal = parseFloat(form.principal_amount);
  const rate = parseFloat(form.interest_rate);
  const months = parseInt(form.period_months, 10);
  const estimated = parseFloat(form.estimated_value);
  const ready = principal > 0 && rate >= 0 && months >= 1;
  const interestPerPeriod = ready ? calculateInterestPerPeriod(principal, rate, form.interest_type) : null;
  const dueDate = ready ? addInterval(form.start_date ? new Date(form.start_date) : new Date(), 'monthly', months) : null;
  const ltv = principal > 0 && estimated > 0 ? Math.round((principal / estimated) * 1000) / 10 : null;
  const periodWord = { daily: 'day', weekly: 'week', monthly: 'month' }[form.interest_type];

  const addPhotos = (field) => (e) => {
    appendCompressedPhotos(e.target.files, (fn) => setForm((f) => ({ ...f, [field]: fn(f[field]) })), () => showToast('Only the first 4 photos were kept.', 'info'));
    e.target.value = '';
  };
  const removePhoto = (field) => (i) => setForm((f) => ({ ...f, [field]: f[field].filter((_, idx) => idx !== i) }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form, period_months: months };
      const res = await api.post('/pawn/loans', body);
      showToast(`Pawn loan ${res.loan.reference_number} created.`);
      onCreated(res.loan);
    } catch (err) {
      setError(err.message);
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const text = (id, key, props = {}) => (
    <input id={id} className="glass-input" value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} />
  );

  return (
    <form onSubmit={submit} className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={onCancel}><ArrowLeft className="icon" /> Back</button>
        <h2 style={{ fontSize: '28px', margin: 0 }}>New Pawn Loan</h2>
      </div>

      {error && <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>{error}</div>}

      <section className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>1. Customer details</h3>
        <div style={grid}>
          <Field id="pw-name" label="Name *">{text('pw-name', 'customer_name', { required: true, autoComplete: 'off' })}</Field>
          <Field id="pw-father" label="Father / Husband name">{text('pw-father', 'father_husband_name')}</Field>
          <Field id="pw-nic" label="NIC / ID number *" hint="9 digits + V/X, or 12 digits">{text('pw-nic', 'nic_number', { required: true })}</Field>
          <Field id="pw-mobile" label="Mobile number *">{text('pw-mobile', 'mobile', { required: true, type: 'tel', inputMode: 'tel' })}</Field>
          <Field id="pw-occ" label="Occupation">{text('pw-occ', 'occupation')}</Field>
          <Field id="pw-income" label="Monthly income (LKR)">{text('pw-income', 'monthly_income', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}</Field>
          <Field id="pw-refname" label="Reference name">{text('pw-refname', 'reference_name')}</Field>
          <Field id="pw-refphone" label="Reference contact number">{text('pw-refphone', 'reference_phone', { type: 'tel', inputMode: 'tel' })}</Field>
        </div>
        <Field id="pw-address" label="Address"><textarea id="pw-address" className="glass-input" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
      </section>

      <section className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>2. Pawned item</h3>
        <div role="group" aria-label="Pawn type" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" aria-pressed={!isGold} className={`glass-btn ${!isGold ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} onClick={() => set('pawn_type', 'vehicle')}><Car className="icon" /> Vehicle</button>
          <button type="button" aria-pressed={isGold} className={`glass-btn ${isGold ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} onClick={() => set('pawn_type', 'gold')}><Gem className="icon" /> Gold jewellery</button>
        </div>
        <div style={grid}>
          <Field id="pw-desc" label="Item description / details *">{text('pw-desc', 'item_description', { required: true, placeholder: isGold ? 'e.g. 22K gold chain, 2 rings' : 'e.g. Honda Dio scooter, white' })}</Field>
          {!isGold && <Field id="pw-model" label="Make / model">{text('pw-model', 'make_model', { placeholder: 'e.g. Honda Dio 2019' })}</Field>}
          <Field id="pw-reg" label={isGold ? 'Serial / tag number' : 'Registration number'}>{text('pw-reg', 'registration_serial')}</Field>
          {isGold && <Field id="pw-weight" label="Total weight (grams)">{text('pw-weight', 'gold_weight_grams', { type: 'number', min: 0, step: '0.001', inputMode: 'decimal' })}</Field>}
          {isGold && <Field id="pw-karat" label="Karat">{text('pw-karat', 'gold_karat', { placeholder: 'e.g. 22K' })}</Field>}
          <Field id="pw-value" label="Estimated value (LKR) *">{text('pw-value', 'estimated_value', { required: true, type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}</Field>
          <Field id="pw-store" label="Storage location" hint="Where the item is kept, e.g. Safe 2, Shelf B">{text('pw-store', 'storage_location')}</Field>
        </div>
        <div style={grid}>
          <PhotoPicker id="pw-item-photos" label="Item photos" photos={form.item_photos} onAdd={addPhotos('item_photos')} onRemove={removePhoto('item_photos')} />
          <PhotoPicker id="pw-doc-photos" label="Document photos (NIC, vehicle book…)" photos={form.document_photos} onAdd={addPhotos('document_photos')} onRemove={removePhoto('document_photos')} />
        </div>
      </section>

      <section className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>3. Loan terms</h3>
        <div style={grid}>
          <Field id="pw-amount" label="Loan amount (LKR) *">{text('pw-amount', 'principal_amount', { required: true, type: 'number', min: 1, step: '0.01', inputMode: 'decimal' })}</Field>
          <Field id="pw-rate" label="Interest rate (% per month) *" hint="Same method as the other loans: daily = monthly ÷ 30, weekly = monthly ÷ 4">{text('pw-rate', 'interest_rate', { required: true, type: 'number', min: 0, step: '0.001', inputMode: 'decimal' })}</Field>
          <Field id="pw-itype" label="Interest collected">
            <select id="pw-itype" className="glass-input" value={form.interest_type} onChange={(e) => set('interest_type', e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </Field>
          <Field id="pw-period" label="Loan period (months) *">{text('pw-period', 'period_months', { required: true, type: 'number', min: 1, max: 60, step: 1, inputMode: 'numeric' })}</Field>
          <Field id="pw-start" label="Start date (optional)" hint="Leave blank for today. Use only to enter an older paper ticket.">
            <TypedDateInput id="pw-start" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
        </div>
        {ready && (
          <div role="status" style={{ background: 'var(--bg-tertiary)', borderRadius: '12px', padding: '14px 16px', fontSize: '14px', lineHeight: 1.7 }}>
            <div>Interest per {periodWord}: <strong>{money(interestPerPeriod)}</strong></div>
            <div>Due date: <strong>{fmtDate(dueDate)}</strong> · 30 days' grace after that before the item can be forfeited</div>
            {ltv !== null && <div>Loan is <strong>{ltv}%</strong> of the item's estimated value{ltv > 100 ? ' — more than the item is worth!' : ''}</div>}
            {ltv > 100 && <div style={{ color: 'var(--accent-rose)', display: 'flex', alignItems: 'center', gap: '6px' }}><TriangleAlert className="icon" /> Please double-check the loan amount and estimated value.</div>}
          </div>
        )}
        <Field id="pw-notes" label="Notes"><textarea id="pw-notes" className="glass-input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </section>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button type="submit" className="glass-btn glass-btn-emerald" style={{ padding: '14px 28px' }} disabled={saving}>
          <Check className="icon" /> {saving ? 'Saving…' : 'Create Pawn Loan'}
        </button>
        <button type="button" className="glass-btn glass-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Loan detail
// ---------------------------------------------------------------------------
function PawnDetail({ data, orgName, showToast, onBack, onChanged }) {
  const [dialog, setDialog] = useState(null); // 'extend' | 'forfeit' | 'ticket' | 'return'
  const [ticketLang, setTicketLang] = useState('en');
  const [pay, setPay] = useState({ payment_type: 'interest', amount: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());
  const [extend, setExtend] = useState({ additional_months: '1', reason: '' });
  const [forfeit, setForfeit] = useState({ reason: '', auction_proceeds: '', allow_early: false });
  const [returnNote, setReturnNote] = useState('');
  const [dialogError, setDialogError] = useState('');
  const closeDialog = useCallback(() => { setDialog(null); setDialogError(''); }, []);

  if (!data) {
    return (
      <div className="animate-fade-in">
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={onBack}><ArrowLeft className="icon" /> Back</button>
        <div className="glass-card" style={{ padding: '24px', marginTop: '16px' }}>Loading…</div>
      </div>
    );
  }

  const { loan, payments, accruals, ledger } = data;
  const active = loan.status === 'active';
  const interestDue = parseFloat(loan.interest_balance) || 0;
  const principalLeft = parseFloat(loan.principal_outstanding) || 0;
  const photos = (loan.item_photo_urls || []).concat(loan.document_photo_urls || []);

  const submitPayment = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/pawn/loans/${loan.id}/payments`, { ...pay, idempotency_key: keyRef.current });
      keyRef.current = newKey();
      setPay({ payment_type: pay.payment_type, amount: '', notes: '' });
      showToast(res.message);
      onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn, successMessage) => {
    setBusy(true);
    setDialogError('');
    try {
      await fn();
      showToast(successMessage);
      closeDialog();
      onChanged();
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const infoRow = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '7px 0', borderBottom: '1px solid var(--border-light)', fontSize: '14px' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <strong style={{ textAlign: 'right' }}>{value || '-'}</strong>
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={onBack}><ArrowLeft className="icon" /> Back</button>
          <div>
            <h2 style={{ fontSize: '26px', margin: 0 }}>{loan.reference_number} · {loan.customer_name}</h2>
            <div style={{ marginTop: '6px' }}><StatusBadge loan={loan} /></div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setDialog('ticket')}><Printer className="icon" /> Print ticket</button>
          {active && <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setDialog('extend')}><CalendarPlus className="icon" /> Extend due date</button>}
          {active && <button type="button" className="glass-btn glass-btn-rose" onClick={() => setDialog('forfeit')}><Gavel className="icon" /> Forfeit item</button>}
          {loan.status === 'redeemed' && !loan.item_returned_at && <button type="button" className="glass-btn glass-btn-emerald" onClick={() => setDialog('return')}><Package className="icon" /> Return item to customer</button>}
        </div>
      </div>

      {active && loan.is_overdue && (
        <div role="status" className="glass-card" style={{ borderLeft: `4px solid ${loan.can_forfeit ? 'var(--accent-rose)' : 'var(--accent-amber)'}`, padding: '14px 18px' }}>
          <strong>{loan.days_overdue} day{loan.days_overdue === 1 ? '' : 's'} past the due date.</strong>{' '}
          {loan.can_forfeit ? 'The 30-day grace period is over — the item can now be forfeited.' : `${loan.days_until_forfeitable} more day${loan.days_until_forfeitable === 1 ? '' : 's'} of grace before the item can be forfeited.`}
        </div>
      )}
      {loan.status === 'redeemed' && !loan.item_returned_at && (
        <div role="status" className="glass-card" style={{ borderLeft: '4px solid var(--accent-emerald)', padding: '14px 18px' }}>
          Fully paid. Hand the item back to the customer, then tap <strong>Return item to customer</strong>.
        </div>
      )}
      {loan.status === 'forfeited' && (
        <div role="status" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', padding: '14px 18px' }}>
          Forfeited on {fmtDate(loan.forfeited_at)}. {loan.forfeit_reason} Auction proceeds {money(loan.auction_proceeds)}.
          {parseFloat(loan.surplus_due) > 0 && <strong> Surplus owed back to the customer: {money(loan.surplus_due)}.</strong>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', alignItems: 'start' }}>
        <section className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '18px' }}>Balances & terms</h3>
          {infoRow('Loan amount', money(loan.principal_amount))}
          {infoRow('Principal outstanding', money(loan.principal_outstanding))}
          {infoRow('Interest due', money(loan.interest_balance))}
          {infoRow('Total owed', money(loan.total_outstanding))}
          {infoRow('Interest rate', `${Number(loan.interest_rate)}% per month, collected ${loan.interest_type}`)}
          {infoRow('Start date', fmtDate(loan.start_date))}
          {infoRow('Due date', `${fmtDate(loan.due_date)} (${loan.period_months} month${loan.period_months === 1 ? '' : 's'})`)}
          {infoRow('Loan vs item value', loan.loan_to_value_percent !== null ? `${loan.loan_to_value_percent}%` : '-')}
        </section>

        <section className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '18px' }}>{loan.pawn_type === 'gold' ? <Gem className="icon" /> : <Car className="icon" />} Pawned item</h3>
          {infoRow('Type', loan.pawn_type === 'gold' ? 'Gold jewellery' : 'Vehicle')}
          {infoRow('Description', loan.item_description)}
          {loan.pawn_type === 'vehicle' && infoRow('Make / model', loan.make_model)}
          {infoRow(loan.pawn_type === 'gold' ? 'Serial / tag' : 'Registration no.', loan.registration_serial)}
          {loan.pawn_type === 'gold' && infoRow('Weight / karat', [loan.gold_weight_grams ? `${Number(loan.gold_weight_grams)} g` : '', loan.gold_karat].filter(Boolean).join(' / '))}
          {infoRow('Estimated value', money(loan.estimated_value))}
          {infoRow('Stored at', loan.storage_location)}
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {photos.map((src, i) => <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Pawn photo ${i + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-light)' }} /></a>)}
            </div>
          )}
        </section>

        <section className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '18px' }}>Customer</h3>
          {infoRow('Name', loan.customer_name)}
          {infoRow('Father / husband', loan.father_husband_name)}
          {infoRow('NIC', loan.nic_number)}
          {infoRow('Mobile', loan.mobile)}
          {infoRow('Address', loan.address)}
          {infoRow('Occupation', loan.occupation)}
          {infoRow('Monthly income', loan.monthly_income ? money(loan.monthly_income) : '')}
          {infoRow('Reference', [loan.reference_name, loan.reference_phone].filter(Boolean).join(' · '))}
        </section>
      </div>

      {active && (
        <form onSubmit={submitPayment} className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>Record a payment</h3>
          <div role="group" aria-label="Payment type" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" aria-pressed={pay.payment_type === 'interest'} className={`glass-btn ${pay.payment_type === 'interest' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} onClick={() => setPay((p) => ({ ...p, payment_type: 'interest', amount: '' }))}>Pay interest</button>
            <button type="button" aria-pressed={pay.payment_type === 'principal'} className={`glass-btn ${pay.payment_type === 'principal' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} onClick={() => setPay((p) => ({ ...p, payment_type: 'principal', amount: '' }))}>Pay principal</button>
          </div>
          <div style={grid}>
            <Field id="pp-amount" label="Amount (LKR) *" hint={pay.payment_type === 'interest' ? `Interest due: ${money(interestDue)}` : `Principal outstanding: ${money(principalLeft)}`}>
              <input id="pp-amount" className="glass-input" type="number" min="0.01" step="0.01" inputMode="decimal" required value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} />
            </Field>
            <Field id="pp-notes" label="Notes">
              <input id="pp-notes" className="glass-input" value={pay.notes} onChange={(e) => setPay((p) => ({ ...p, notes: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="submit" className="glass-btn glass-btn-emerald" disabled={busy}><Check className="icon" /> {busy ? 'Saving…' : 'Collect payment'}</button>
            <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setPay((p) => ({ ...p, amount: String(p.payment_type === 'interest' ? interestDue : principalLeft) }))}>
              Fill {pay.payment_type === 'interest' ? 'all interest due' : 'full principal'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>To redeem the item, pay all the interest and then the full principal. The loan closes once both reach zero.</div>
        </form>
      )}

      <section className="glass-card" style={{ padding: '20px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '18px' }}>Payments received ({payments.length})</h3>
        {payments.length === 0 ? <div style={{ color: 'var(--text-secondary)' }}>No payments yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}><th style={{ padding: '8px' }}>Date</th><th style={{ padding: '8px' }}>Type</th><th style={{ padding: '8px' }}>Amount</th><th style={{ padding: '8px' }}>Received by</th><th style={{ padding: '8px' }}>Notes</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '8px' }}>{fmtDate(p.payment_date)}</td>
                    <td style={{ padding: '8px', textTransform: 'capitalize' }}>{p.payment_type}</td>
                    <td style={{ padding: '8px' }}><strong>{money(p.amount)}</strong></td>
                    <td style={{ padding: '8px' }}>{p.received_by_name || '-'}</td>
                    <td style={{ padding: '8px' }}>{p.notes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="glass-card" style={{ padding: '20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>Interest history ({accruals.length}) and ledger entries ({ledger.length})</summary>
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <strong>Interest added</strong>
            {accruals.length === 0 ? <div style={{ color: 'var(--text-secondary)' }}>None yet.</div> : accruals.map((a) => (
              <div key={a.id} style={{ fontSize: '13px', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}><strong>+{money(a.amount_accrued)}</strong> · {a.calculation_log}</div>
            ))}
          </div>
          <div>
            <strong>Pawn ledger</strong>
            {ledger.map((l) => (
              <div key={l.id} style={{ fontSize: '13px', padding: '4px 0', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span>{l.account.replace('pawn_', '').replace(/_/g, ' ')} <em style={{ color: 'var(--text-muted)' }}>({l.type})</em></span><span>{money(l.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </details>

      {/* ---- dialogs ---- */}
      {dialog === 'extend' && (
        <Dialog title="Extend due date" onClose={closeDialog}>
          <form onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/pawn/loans/${loan.id}/extend`, extend), 'Due date extended.'); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>Gives the customer more time. Interest keeps adding up at {Number(loan.interest_rate)}% per month. Current due date: {fmtDate(loan.due_date)}.</p>
            <Field id="ex-months" label="Extend by (months)"><input id="ex-months" className="glass-input" type="number" min="1" max="12" required value={extend.additional_months} onChange={(e) => setExtend((x) => ({ ...x, additional_months: e.target.value }))} /></Field>
            <Field id="ex-reason" label="Reason (optional)"><input id="ex-reason" className="glass-input" value={extend.reason} onChange={(e) => setExtend((x) => ({ ...x, reason: e.target.value }))} /></Field>
            {dialogError && <div role="alert" style={{ color: 'var(--accent-rose)' }}>{dialogError}</div>}
            <button type="submit" className="glass-btn glass-btn-emerald" disabled={busy}>{busy ? 'Saving…' : 'Extend due date'}</button>
          </form>
        </Dialog>
      )}

      {dialog === 'forfeit' && (
        <Dialog title="Forfeit item" onClose={closeDialog}>
          <form onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/pawn/loans/${loan.id}/forfeit`, forfeit), 'Pawn loan forfeited.'); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div role="alert" style={{ background: 'var(--bg-tertiary)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }}>
              <strong>This closes the loan and cannot be undone.</strong> Auction proceeds pay the interest first, then the principal. Any extra money is recorded as owed back to the customer; any shortfall is written off. The customer is sent an SMS.
              <div style={{ marginTop: '6px' }}>Currently owed: <strong>{money(loan.total_outstanding)}</strong></div>
            </div>
            {!loan.can_forfeit && (
              <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', color: 'var(--accent-rose)' }}>
                <input type="checkbox" checked={forfeit.allow_early} onChange={(e) => setForfeit((f) => ({ ...f, allow_early: e.target.checked }))} style={{ marginTop: '3px' }} />
                <span>The 30-day grace period has not finished. I understand and want to forfeit this item early.</span>
              </label>
            )}
            <Field id="ff-proceeds" label="Auction / sale proceeds (LKR)" hint="Leave blank or 0 if not sold yet"><input id="ff-proceeds" className="glass-input" type="number" min="0" step="0.01" inputMode="decimal" value={forfeit.auction_proceeds} onChange={(e) => setForfeit((f) => ({ ...f, auction_proceeds: e.target.value }))} /></Field>
            <Field id="ff-reason" label="Reason *"><input id="ff-reason" className="glass-input" required value={forfeit.reason} onChange={(e) => setForfeit((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Not paid after the grace period" /></Field>
            {dialogError && <div role="alert" style={{ color: 'var(--accent-rose)' }}>{dialogError}</div>}
            <button type="submit" className="glass-btn glass-btn-rose" disabled={busy || (!loan.can_forfeit && !forfeit.allow_early)}>{busy ? 'Saving…' : 'Forfeit this item'}</button>
          </form>
        </Dialog>
      )}

      {dialog === 'return' && (
        <Dialog title="Return item to customer" onClose={closeDialog}>
          <form onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/pawn/loans/${loan.id}/return-item`, { note: returnNote }), 'Item marked as returned.'); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>Confirm you have handed <strong>{loan.item_description}</strong> back to {loan.customer_name}.</p>
            <Field id="rt-note" label="Note (optional)"><input id="rt-note" className="glass-input" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="e.g. Collected in person, checked NIC" /></Field>
            {dialogError && <div role="alert" style={{ color: 'var(--accent-rose)' }}>{dialogError}</div>}
            <button type="submit" className="glass-btn glass-btn-emerald" disabled={busy}><RotateCcw className="icon" /> {busy ? 'Saving…' : 'Yes, item returned'}</button>
          </form>
        </Dialog>
      )}

      {dialog === 'ticket' && (
        <div className="receipt-modal-overlay pawn-ticket-overlay" onClick={closeDialog}>
          <div className="pawn-ticket-modal" role="dialog" aria-modal="true" aria-label="Pawn ticket" onClick={(e) => e.stopPropagation()}>
            <div className="no-print" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
              <div role="group" aria-label="Ticket language" style={{ display: 'flex', gap: '8px' }}>
                <button type="button" aria-pressed={ticketLang === 'en'} className={`glass-btn ${ticketLang === 'en' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} onClick={() => setTicketLang('en')}>English</button>
                <button type="button" aria-pressed={ticketLang === 'ta'} className={`glass-btn ${ticketLang === 'ta' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} onClick={() => setTicketLang('ta')}>தமிழ்</button>
              </div>
              <button type="button" className="glass-btn glass-btn-emerald" onClick={() => window.print()}><Printer className="icon" /> Print</button>
              <button type="button" className="glass-btn glass-btn-secondary" onClick={closeDialog}>Close</button>
            </div>
            <PawnTicket loan={loan} lang={ticketLang} orgName={orgName} />
          </div>
        </div>
      )}
    </div>
  );
}
