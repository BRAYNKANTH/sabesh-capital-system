import { BANK_ACCOUNTS, formatBankDetailsText } from './bankAccounts.js';
import { publicSiteUrl, LIVE_SITE_URL } from './siteUrl.js';

// Link that opens the WhatsApp app itself (no web page in between).
export function whatsappAppUrl({ phone, text } = {}) {
  const parts = [];
  if (phone) parts.push(`phone=${encodeURIComponent(phone)}`);
  if (text) parts.push(`text=${encodeURIComponent(text)}`);
  return `whatsapp://send${parts.length ? `?${parts.join('&')}` : ''}`;
}

// Link for computers (WhatsApp Web / desktop app).
export function whatsappWebUrl({ phone, text } = {}) {
  return `https://wa.me/${phone || ''}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// iPhone, iPad (including iPadOS, which reports itself as a Mac) and Android.
export function isMobileDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

// Opens WhatsApp with a ready message. On a phone it goes straight to the app: the old
// https://api.whatsapp.com link opened a browser tab that loaded a WhatsApp web page and only then
// handed over to the app (the page flashed and vanished). Call this from a tap/click handler.
// `phone` (country code, digits only) is optional; without it WhatsApp asks who to send to.
export function openWhatsApp({ phone, text } = {}) {
  if (typeof window === 'undefined') return;
  const mobile = isMobileDevice({
    userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints
  });
  if (mobile) {
    window.location.href = whatsappAppUrl({ phone, text });
  } else {
    window.open(whatsappWebUrl({ phone, text }), '_blank', 'noopener,noreferrer');
  }
}

// Adds the bank accounts, and a link to the copy-friendly /pay page, at the bottom of a message.
export function appendBankDetails(text, { accounts = BANK_ACCOUNTS, payUrl } = {}) {
  const base = typeof window === 'undefined'
    ? LIVE_SITE_URL
    : publicSiteUrl({ envUrl: process.env.NEXT_PUBLIC_SITE_URL, hostname: window.location.hostname, origin: window.location.origin });
  return `${text}\n\n${formatBankDetailsText(accounts, payUrl || `${base}/pay`)}`;
}
