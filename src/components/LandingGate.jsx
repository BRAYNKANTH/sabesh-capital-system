'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import LandingPage from './LandingPage.jsx';

// LendApp reads localStorage/window synchronously during render (ported
// near-verbatim from the original Vite SPA), so it can't be server-rendered
// — load it client-only instead of auditing every usage for SSR-safety.
const LendApp = dynamic(() => import('./LendApp.jsx'), { ssr: false });

// What "/" shows. Visitors get the public landing page. Staff go straight to the app when they are
// already signed in, or when they arrive with ?login=1 (the "Staff login" buttons and the installed
// phone app use that address).
export default function LandingGate({ openApp }) {
  const [showApp, setShowApp] = useState(!!openApp);

  useEffect(() => {
    try {
      if (localStorage.getItem('lend_token')) setShowApp(true);
    } catch {
      // Storage blocked: stay on the landing page; the Staff login button still works.
    }
  }, []);

  return showApp ? <LendApp /> : <LandingPage />;
}
