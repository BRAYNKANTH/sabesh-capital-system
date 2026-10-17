'use client';

import React from 'react';
import { compressImageFile, MAX_KYC_PHOTOS } from '@/lib/clientImageCompress.js';
import { X, Plus } from 'lucide-react';

// The member's own details. (Name and phone are the member's main fields.)
export const EMPTY_MEMBER_DETAILS = { nic_number: '', address: '', nic_photos: [], photo: '' };
// The optional guarantor: just a NIC number and a phone number.
export const EMPTY_GUARANTOR = { nic_number: '', phone: '' };

const labelStyle = { display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' };

function Thumb({ src, alt, onRemove }) {
  return (
    <div style={{ position: 'relative', width: 'fit-content' }}>
      <img src={src} alt={alt} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-light)' }} />
      <button type="button" aria-label={`Remove ${alt}`} onClick={onRemove}
        style={{ position: 'absolute', top: '-8px', right: '-8px', width: '26px', height: '26px', borderRadius: '50%', border: 'none', background: 'var(--accent-rose)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X style={{ width: '14px', height: '14px' }} />
      </button>
    </div>
  );
}

// NIC number, address (required), NIC photos (several) and the member's own
// photo (optional). Controlled by the parent: value is
// { nic_number, address, nic_photos[], photo }.
export function MemberDetailsFields({ idPrefix = 'md', value, onChange, onNotice }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const addNicPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    try {
      const compressed = await Promise.all(files.map((f) => compressImageFile(f)));
      const combined = [...(value.nic_photos || []), ...compressed];
      if (combined.length > MAX_KYC_PHOTOS) onNotice?.(`Only the first ${MAX_KYC_PHOTOS} NIC photos were kept.`);
      set({ nic_photos: combined.slice(0, MAX_KYC_PHOTOS) });
    } catch {
      onNotice?.('One of the photos could not be read. Please try another image.');
    }
  };

  const setPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      set({ photo: await compressImageFile(file) });
    } catch {
      onNotice?.('That photo could not be read. Please try another image.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <label htmlFor={`${idPrefix}-nic`} style={labelStyle}>NIC number *</label>
        <input id={`${idPrefix}-nic`} required type="text" className="glass-input" placeholder="123456789V or 199012345678" value={value.nic_number} onChange={(e) => set({ nic_number: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-address`} style={labelStyle}>Address *</label>
        <textarea id={`${idPrefix}-address`} required rows={2} className="glass-input" value={value.address} onChange={(e) => set({ address: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-nicphotos`} style={labelStyle}>NIC photos (front, back… up to {MAX_KYC_PHOTOS})</label>
        <input id={`${idPrefix}-nicphotos`} type="file" accept="image/*" multiple className="glass-input" onChange={addNicPhotos} />
        {(value.nic_photos || []).length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
            {value.nic_photos.map((src, i) => (
              <Thumb key={i} src={src} alt={`NIC photo ${i + 1}`} onRemove={() => set({ nic_photos: value.nic_photos.filter((_, idx) => idx !== i) })} />
            ))}
          </div>
        )}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-photo`} style={labelStyle}>Member's photo</label>
        <input id={`${idPrefix}-photo`} type="file" accept="image/*" capture="user" className="glass-input" onChange={setPhoto} />
        {value.photo && (
          <div style={{ marginTop: '10px' }}>
            <Thumb src={value.photo} alt="member photo" onRemove={() => set({ photo: '' })} />
          </div>
        )}
      </div>
    </div>
  );
}

// One quiet line at the bottom of the form: "Add guarantor details (optional)".
// value is null when there is no guarantor, otherwise { nic_number, phone }.
export function GuarantorFields({ idPrefix = 'gf', value, onChange }) {
  if (!value) {
    return (
      <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px', fontSize: '13px', alignSelf: 'flex-start' }} onClick={() => onChange({ ...EMPTY_GUARANTOR })}>
        <Plus style={{ width: '14px', height: '14px', marginRight: '4px' }} /> Add guarantor details (optional)
      </button>
    );
  }
  return (
    <div style={{ border: '1px solid var(--border-light)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <strong style={{ fontSize: '14px' }}>Guarantor (optional)</strong>
        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => onChange(null)}>Remove guarantor</button>
      </div>
      <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div>
          <label htmlFor={`${idPrefix}-nic`} style={labelStyle}>Guarantor's NIC number *</label>
          <input id={`${idPrefix}-nic`} required type="text" className="glass-input" placeholder="123456789V or 199012345678" value={value.nic_number} onChange={(e) => onChange({ ...value, nic_number: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-phone`} style={labelStyle}>Guarantor's phone number *</label>
          <input id={`${idPrefix}-phone`} required type="tel" inputMode="tel" maxLength={30} className="glass-input" placeholder="e.g. 0771234567" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
