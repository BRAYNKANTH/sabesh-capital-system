'use client';

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/apiClient.js';
import { Phone, Search, ShieldCheck, X } from 'lucide-react';

const labelStyle = { fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' };

function CallLink({ phone }) {
  const dial = (phone || '').replace(/[^0-9+]/g, '');
  if (!dial) return <span>—</span>;
  return (
    <a href={`tel:${dial}`} className="phone-link" aria-label={`Call ${phone}`}>
      <Phone className="icon" style={{ width: '13px', height: '13px' }} aria-hidden="true" />
      {phone}
    </a>
  );
}

// Full-screen look at one photo. Escape or the Close button leaves.
function PhotoViewer({ photo, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="receipt-modal-overlay" onClick={onClose} style={{ zIndex: 2100 }}>
      <div role="dialog" aria-modal="true" aria-label="Photo" className="glass-card" style={{ maxWidth: '900px', width: '100%', padding: '16px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <strong>{photo.title}</strong>
          <button type="button" autoFocus className="glass-btn glass-btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={onClose}>
            <X className="icon" style={{ width: '14px', height: '14px' }} /> Close
          </button>
        </div>
        <img src={photo.src} alt={photo.title} style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: '10px', background: 'var(--bg-secondary, #f1f5f9)' }} />
      </div>
    </div>
  );
}

function PhotoTile({ src, title, width, height, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen({ src, title })} aria-label={`View ${title} full size`}
      style={{ padding: 0, border: '1px solid var(--border-light)', borderRadius: '10px', overflow: 'hidden', cursor: 'zoom-in', background: 'transparent', width, height, flex: '0 0 auto' }}>
      <img src={src} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </button>
  );
}

function GuarantorCard({ ticketId, member, isAdmin, onEdit, onOpenPhoto }) {
  const g = member.guarantor;
  const cardRef = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [full, setFull] = useState(null);
  const [failed, setFailed] = useState(false);

  // Photos are only fetched once the card scrolls near the screen, so a
  // big group does not download every photo up front.
  useEffect(() => {
    if (visible || !cardRef.current) return undefined;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '300px' });
    obs.observe(cardRef.current);
    return () => obs.disconnect();
  }, [visible]);

  const signature = g ? `${g.full_name}|${g.nic_number}|${g.phone}|${g.address}|${g.nic_photo_count}|${g.has_photo}|${g.updated_at}` : '';
  useEffect(() => {
    if (!g || !visible) return undefined;
    let cancelled = false;
    setFull(null); setFailed(false);
    api.get(`/tickets/${ticketId}/members/${member.id}/guarantor`)
      .then((res) => { if (!cancelled) setFull(res.guarantor); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [ticketId, member.id, signature, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!g) {
    return (
      <div ref={cardRef} className="glass-card" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <strong>{member.name}</strong>
          <div style={{ marginTop: '4px' }}><span className="badge badge-pending" style={{ fontSize: '10px' }}>No guarantor yet</span></div>
        </div>
        {isAdmin && <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '8px 14px', fontSize: '12px' }} onClick={() => onEdit(member)}>Add guarantor</button>}
      </div>
    );
  }

  const nicPhotos = full?.nic_photo_urls || [];
  const hasAnyPhoto = g.nic_photo_count > 0 || g.has_photo;
  return (
    <div ref={cardRef} className="glass-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={labelStyle}>Chit member</div>
          <strong style={{ fontSize: '16px' }}>{member.name}</strong>
          <div style={{ fontSize: '12px', marginTop: '2px' }}><CallLink phone={member.phone} /></div>
        </div>
        {isAdmin && <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => onEdit(member)}>Edit guarantor</button>}
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ ...labelStyle, marginBottom: '6px' }}>Photo</div>
          {full?.photo_url ? (
            <PhotoTile src={full.photo_url} title={`${g.full_name} — photo`} width="120px" height="140px" onOpen={onOpenPhoto} />
          ) : (
            <div style={{ width: '120px', height: '140px', border: '1px dashed var(--border-light)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>
              {g.has_photo ? (failed ? 'Could not load' : 'Loading…') : 'No photo'}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: '10px' }}>
          <div>
            <div style={labelStyle}>Guarantor</div>
            <strong style={{ fontSize: '17px', overflowWrap: 'anywhere' }}>{g.full_name}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            <div>
              <div style={labelStyle}>NIC number</div>
              <span style={{ fontWeight: 600 }}>{g.nic_number}</span>
            </div>
            <div>
              <div style={labelStyle}>Phone</div>
              <CallLink phone={g.phone} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Address</div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{g.address}</div>
          </div>
        </div>
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: '6px' }}>NIC photos ({g.nic_photo_count})</div>
        {g.nic_photo_count === 0 ? (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No NIC photos uploaded.</span>
        ) : failed ? (
          <span role="alert" style={{ fontSize: '12px', color: 'var(--accent-rose)' }}>The photos could not be loaded. Please refresh.</span>
        ) : !full ? (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading photos…</span>
        ) : (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {nicPhotos.map((src, i) => (
              <PhotoTile key={i} src={src} title={`${g.full_name} — NIC photo ${i + 1}`} width="170px" height="115px" onOpen={onOpenPhoto} />
            ))}
          </div>
        )}
        {hasAnyPhoto && full && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>Tap a photo to see it full size.</div>}
      </div>
    </div>
  );
}

// "Guarantors" tab of a chit group: every member's guarantor in one place,
// with the details and photos laid out clearly.
export default function ChitGuarantorsTab({ ticketId, members, isAdmin, onEdit }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | missing
  const [photo, setPhoto] = useState(null);

  const withG = members.filter((m) => m.guarantor).length;
  const missing = members.length - withG;
  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => {
    if (filter === 'missing' && m.guarantor) return false;
    if (!q) return true;
    const g = m.guarantor;
    return [m.name, m.phone, g?.full_name, g?.nic_number, g?.phone, g?.address].some((v) => String(v || '').toLowerCase().includes(q));
  });

  return (
    <div className="glass-card animate-fade-in" style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', marginBottom: '6px', fontWeight: 'bold' }}><ShieldCheck className="icon" /> Guarantors</h3>
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        {withG} of {members.length} members have a guarantor on file{missing > 0 ? ` — ${missing} still missing.` : '.'}
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search aria-hidden="true" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '16px', height: '16px', color: 'var(--text-muted)' }} />
          <input type="search" aria-label="Search guarantors" className="glass-input" placeholder="Search by member, guarantor, NIC, phone or address" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: '38px', width: '100%' }} />
        </div>
        <button type="button" className={`glass-btn ${filter === 'all' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '8px 14px', fontSize: '12px' }} onClick={() => setFilter('all')}>All ({members.length})</button>
        <button type="button" className={`glass-btn ${filter === 'missing' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '8px 14px', fontSize: '12px' }} onClick={() => setFilter('missing')}>No guarantor ({missing})</button>
      </div>

      {shown.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{members.length === 0 ? 'No members in this group yet.' : 'Nothing matches.'}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: '14px' }}>
          {shown.map((m) => (
            <GuarantorCard key={m.id} ticketId={ticketId} member={m} isAdmin={isAdmin} onEdit={onEdit} onOpenPhoto={setPhoto} />
          ))}
        </div>
      )}

      {photo && <PhotoViewer photo={photo} onClose={() => setPhoto(null)} />}
    </div>
  );
}
