// The public address of this site, used for the QR code on the bank-details page.
// NEXT_PUBLIC_SITE_URL wins when set (e.g. after moving to a custom domain). When the page is
// opened on a development address (localhost or a home/office network address), the live site is
// used instead, so a QR made while testing never points at a computer nobody else can reach.
export const LIVE_SITE_URL = 'https://sabesfinance.lk';

export function isDevHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return (
    h === 'localhost' || h.endsWith('.localhost') ||
    h === '127.0.0.1' || h === '[::1]' || h === '::1' ||
    /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

// Links and QR codes always use the public domain, whichever address the page was opened from
// (localhost, the old vercel.app address, ...). NEXT_PUBLIC_SITE_URL overrides it.
export function publicSiteUrl({ envUrl } = {}) {
  return String(envUrl || LIVE_SITE_URL).replace(/\/+$/, '');
}
