import localFont from 'next/font/local';
import db from '@/lib/db.js';
import './globals.css';

// Self-hosted as actual files checked into the repo (src/fonts/), not
// fetched from Google at build time via next/font/google. That previous
// approach still required every single Vercel build to reach
// fonts.googleapis.com/fonts.gstatic.com during compilation to download
// and subset the font — when Google's fonts CDN had a transient hiccup
// (or a build ran from a region with a flaky route to it), the build
// failed outright with an opaque `next/font` TypeError, blocking every
// deployment across every organization on this platform until someone
// happened to retry at the right moment. Vendoring the actual files
// removes that external dependency from the build entirely: these are the
// same variable-font files Google would have served (single file per
// family, covering the whole weight range via next/font/local's `weight`
// range syntax below), just no longer fetched fresh on every build.
const inter = localFont({
  src: '../fonts/inter/Inter-Variable.woff2',
  weight: '300 700',
  variable: '--font-inter',
  display: 'swap'
});

const outfit = localFont({
  src: '../fonts/outfit/Outfit-Variable.woff2',
  weight: '400 800',
  variable: '--font-outfit',
  display: 'swap'
});

// Forces this layout (and the metadata below) to be rendered per-request
// rather than baked into a static HTML shell at build time — without
// this, Next prerenders the page once at build time with whatever was in
// the database THEN, so an admin changing the org name/logo in Settings
// wouldn't show up in the browser tab title or favicon until the next
// deploy, breaking the "no redeploy needed" point of this whole feature
// (the in-app header/login already update instantly since those are
// fetched client-side, but this server-rendered metadata needs the same
// opt-out explicitly).
export const dynamic = 'force-dynamic';

// Reads this org's own name from its own database for the browser tab
// title — same org_settings row the app itself reads via GET /api/settings
// (see src/app/api/settings/route.js). Falls back to a generic title
// rather than throwing if DATABASE_URL isn't set at all, which is exactly
// the case for the dedicated /platform-admin deployment: this root layout
// wraps every route in the app, including that one, and that deployment
// deliberately has no DATABASE_URL (only PLATFORM_DATABASE_URL) — see
// src/lib/platformDb.js.
//
// Favicon/apple-touch-icon point at /api/org-icon (see that route) instead
// of the old static per-file STN icons — it resizes/pads THIS org's own
// uploaded logo (or a neutral placeholder if none is set yet) to whatever
// size each icon slot needs, using sharp. The PWA manifest itself is
// src/app/manifest.js, a Next.js special file Next auto-links on its own
// — no `manifest:` entry needed here.
export async function generateMetadata() {
  let orgName = 'Cash Lending Management System';
  try {
    if (process.env.DATABASE_URL) {
      const settings = await db('org_settings').first();
      if (settings?.org_name) orgName = settings.org_name;
    }
  } catch {
    // DB unreachable at build/request time — fall back silently, a wrong
    // tab title is never worth failing the page over.
  }

  return {
    title: orgName.toUpperCase(),
    description: 'Cash Lending & Agent Collection Management System',
    icons: {
      icon: [
        { url: '/api/org-icon?size=32', type: 'image/png', sizes: '32x32' },
        { url: '/api/org-icon?size=192', type: 'image/png', sizes: '192x192' }
      ],
      shortcut: '/api/org-icon?size=48',
      apple: '/api/org-icon?size=180'
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: orgName
    }
  };
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2554e8',
  viewportFit: 'cover'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
