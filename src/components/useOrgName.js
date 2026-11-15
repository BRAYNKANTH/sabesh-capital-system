'use client';

import { useState, useEffect } from 'react';

const FALLBACK = 'Sabesh Capital';

// The organisation's name for the public pages. /api/settings is public (the login screen uses it
// too). An unset name ("My Organization") or a failed request keeps the fallback.
export default function useOrgName() {
  const [name, setName] = useState(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        const n = s?.org_name?.trim();
        if (!cancelled && n && n !== 'My Organization') setName(n);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return name;
}
