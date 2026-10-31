'use client';

import React from 'react';
import { chipColors } from '@/lib/services/chitCode.js';

// A group's short code as a small coloured tag. The colour comes from the code,
// so a group looks the same everywhere. Shows nothing for a group that has no
// code yet.
export default function ChitGroupChip({ code, size = 'md' }) {
  if (!code) return null;
  const { bg, fg } = chipColors(code);
  const small = size === 'sm';
  return (
    <span
      title={`Group code ${code}`}
      style={{
        display: 'inline-block', flexShrink: 0, background: bg, color: fg, fontWeight: 800, letterSpacing: '0.04em', whiteSpace: 'nowrap',
        borderRadius: '8px', padding: small ? '1px 8px' : '3px 10px', fontSize: small ? '12px' : '13px', lineHeight: 1.4
      }}
    >
      {code}
    </span>
  );
}
