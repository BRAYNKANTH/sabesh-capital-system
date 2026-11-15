import db from '@/lib/db.js';

// Forces this to be evaluated per-request rather than baked at build time
// — same reasoning as layout.js's `dynamic = 'force-dynamic'`: without
// it, a name/logo changed via Settings wouldn't show up here until the
// next deploy.
export const dynamic = 'force-dynamic';

// Next.js's special-file convention for a dynamic web app manifest —
// auto-served at /manifest.webmanifest with the right content type, and
// Next automatically injects the <link rel="manifest"> tag for it (no
// need to reference it manually in layout.js's metadata). Replaces the
// old static public/manifest.webmanifest, which hardcoded STN's name and
// pointed at STN-branded icon files — this org's own name and logo (via
// /api/org-icon, see that route) now come from its own database, same as
// everywhere else branding shows up in the app.
export default async function manifest() {
  let orgName = 'Cash Lending Management System';
  if (process.env.DATABASE_URL) {
    try {
      const settings = await db('org_settings').first();
      if (settings?.org_name) orgName = settings.org_name;
    } catch {
      // DB unreachable — fall back to the generic name below rather than failing the manifest.
    }
  }

  return {
    name: orgName,
    short_name: orgName.length > 20 ? orgName.slice(0, 17) + '…' : orgName,
    description: 'Cash Lending & Agent Collection Management System',
    // Opens the app's sign-in; plain '/' is the public landing page for visitors.
    start_url: '/?login=1',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef2f9',
    theme_color: '#2554e8',
    icons: [
      { src: '/api/org-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/org-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/api/org-icon?size=512&purpose=maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
