'use client';

import React from 'react';
import { compressImageFile, MAX_KYC_PHOTOS } from '@/lib/clientImageCompress.js';
import { X } from 'lucide-react';

export const EMPTY_GUARANTOR = { full_name: '', nic_number: '', phone: '', address: '', nic_photos: [], photo: '' };

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

// The guarantor's details: name, NIC, phone, address (required), NIC photos
// (several) and the guarantor's own photo (optional). Controlled by the parent:
// value is { full_name, nic_number, phone, address, nic_photos[], photo }.
export function ChitGuarantorFields({ idPrefix = 'cg', value, onChange, onNotice }) {
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
        <label htmlFor={`${idPrefix}-name`} style={labelStyle}>Guarantor's full name *</label>
        <input id={`${idPrefix}-name`} required type="text" maxLength={150} className="glass-input" value={value.full_name} onChange={(e) => set({ full_name: e.target.value })} />
      </div>
      <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div>
          <label htmlFor={`${idPrefix}-nic`} style={labelStyle}>Guarantor's NIC number *</label>
          <input id={`${idPrefix}-nic`} required type="text" className="glass-input" placeholder="123456789V or 199012345678" value={value.nic_number} onChange={(e) => set({ nic_number: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-phone`} style={labelStyle}>Guarantor's phone number *</label>
          <input id={`${idPrefix}-phone`} required type="tel" inputMode="tel" maxLength={30} className="glass-input" placeholder="e.g. 0771234567" value={value.phone} onChange={(e) => set({ phone: e.target.value })} />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-address`} style={labelStyle}>Guarantor's address *</label>
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
        <label htmlFor={`${idPrefix}-photo`} style={labelStyle}>Guarantor's photo</label>
        <input id={`${idPrefix}-photo`} type="file" accept="image/*" capture="user" className="glass-input" onChange={setPhoto} />
        {value.photo && (
          <div style={{ marginTop: '10px' }}>
            <Thumb src={value.photo} alt="guarantor photo" onRemove={() => set({ photo: '' })} />
          </div>
        )}
      </div>
    </div>
  );
}
