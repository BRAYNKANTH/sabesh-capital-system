'use client';

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/apiClient.js';
import { Phone, Search, IdCard, X } from 'lucide-react';

const labelStyle = { fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' };

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

function MemberCard({ ticketId, member, isAdmin, onEdit, onOpenPhoto }) {
  const d = member.details;
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

  const signature = d ? `${d.nic_number}|${d.address}|${d.nic_photo_count}|${d.has_photo}|${d.updated_at}` : '';
  const needsPhotos = !!d && (d.nic_photo_count > 0 || d.has_photo);
  useEffect(() => {
    if (!needsPhotos || !visible) return undefined;
    let cancelled = false;
    setFull(null); setFailed(false);
    api.get(`/tickets/${ticketId}/members/${member.id}/details`)
      .then((res) => { if (!cancelled) setFull(res.details || {}); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [ticketId, member.id, signature, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: '17px', overflowWrap: 'anywhere' }}>{member.name}</strong>
        <div style={{ fontSize: '13px', marginTop: '2px' }}><CallLink phone={member.phone} /></div>
      </div>
      {isAdmin && (
        <button type="button" className={`glass-btn ${d ? 'glass-btn-secondary' : 'glass-btn-emerald'}`} style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => onEdit(member)}>
          {d ? 'Edit details' : 'Add details'}
        </button>
      )}
    </div>
  );

  if (!d) {
    return (
      <div ref={cardRef} className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {header}
        <div><span className="badge badge-pending" style={{ fontSize: '12px' }}>No details yet</span></div>
        {g && <GuarantorLine g={g} />}
      </div>
    );
  }

  return (
    <div ref={cardRef} className="glass-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {header}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ ...labelStyle, marginBottom: '6px' }}>Photo</div>
          {full?.photo_url ? (
            <PhotoTile src={full.photo_url} title={`${member.name} — photo`} width="120px" height="140px" onOpen={onOpenPhoto} />
          ) : (
            <div style={{ width: '120px', height: '140px', border: '1px dashed var(--border-light)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>
              {d.has_photo ? (failed ? 'Could not load' : 'Loading…') : 'No photo'}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: '10px' }}>
          <div>
            <div style={labelStyle}>NIC number</div>
            <span style={{ fontWeight: 600, fontSize: '17px' }}>{d.nic_number}</span>
          </div>
          <div>
            <div style={labelStyle}>Address</div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{d.address}</div>
          </div>
        </div>
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: '6px' }}>NIC photos ({d.nic_photo_count})</div>
        {d.nic_photo_count === 0 ? (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No NIC photos uploaded.</span>
        ) : failed ? (
          <span role="alert" style={{ fontSize: '12px', color: 'var(--accent-rose)' }}>The photos could not be loaded. Please refresh.</span>
        ) : !full ? (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading photos…</span>
        ) : (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {(full.nic_photo_urls || []).map((src, i) => (
              <PhotoTile key={i} src={src} title={`${member.name} — NIC photo ${i + 1}`} width="170px" height="115px" onOpen={onOpenPhoto} />
            ))}
          </div>
        )}
        {needsPhotos && full && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>Tap a photo to see it full size.</div>}
      </div>

      <GuarantorLine g={g} />
    </div>
  );
}

// The guarantor sits quietly at the bottom of the card: NIC and phone only.
function GuarantorLine({ g }) {
  return (
    <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '10px', fontSize: '13px' }}>
      {g ? (
        <span><span style={labelStyle}>Guarantor</span>{' '}NIC <strong>{g.nic_number}</strong> · <CallLink phone={g.phone} /></span>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>No guarantor</span>
      )}
    </div>
  );
}

// "Member Details" tab of a chit group: every member's details and photos in
// one place, with the optional guarantor at the bottom of each card.
export default function ChitMemberDetailsTab({ ticketId, members, isAdmin, onEdit }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | missing
  const [photo, setPhoto] = useState(null);

  const withD = members.filter((m) => m.details).length;
  const missing = members.length - withD;
  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => {
    if (filter === 'missing' && m.details) return false;
    if (!q) return true;
    return [m.name, m.phone, m.details?.nic_number, m.details?.address, m.guarantor?.nic_number, m.guarantor?.phone].some((v) => String(v || '').toLowerCase().includes(q));
  });

  return (
    <div className="glass-card animate-fade-in" style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', marginBottom: '6px', fontWeight: 'bold' }}><IdCard className="icon" /> Member Details</h3>
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        {withD} of {members.length} members have their NIC and address on file{missing > 0 ? ` — ${missing} still missing.` : '.'}
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search aria-hidden="true" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '16px', height: '16px', color: 'var(--text-muted)' }} />
          <input type="search" aria-label="Search member details" className="glass-input" placeholder="Search by name, NIC, phone or address" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: '38px', width: '100%' }} />
        </div>
        <button type="button" className={`glass-btn ${filter === 'all' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '8px 14px', fontSize: '12px' }} onClick={() => setFilter('all')}>All ({members.length})</button>
        <button type="button" className={`glass-btn ${filter === 'missing' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '8px 14px', fontSize: '12px' }} onClick={() => setFilter('missing')}>No details ({missing})</button>
      </div>

      {shown.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{members.length === 0 ? 'No members in this group yet.' : 'Nothing matches.'}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: '14px' }}>
          {shown.map((m) => (
            <MemberCard key={m.id} ticketId={ticketId} member={m} isAdmin={isAdmin} onEdit={onEdit} onOpenPhoto={setPhoto} />
          ))}
        </div>
      )}

      {photo && <PhotoViewer photo={photo} onClose={() => setPhoto(null)} />}
    </div>
  );
}
