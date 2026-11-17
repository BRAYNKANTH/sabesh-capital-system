import { describe, it, expect } from 'vitest';
import { publicSiteUrl, isDevHost, LIVE_SITE_URL } from './siteUrl.js';

describe('isDevHost', () => {
  it('treats localhost and private network addresses as development', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '[::1]', '192.168.1.20', '10.0.0.5', '172.16.4.9', '172.31.255.1']) {
      expect(isDevHost(h)).toBe(true);
    }
  });

  it('does not treat public hosts as development', () => {
    for (const h of ['sabeshcapital.vercel.app', 'example.com', '172.32.0.1', '172.15.0.1', '8.8.8.8', '']) {
      expect(isDevHost(h)).toBe(false);
    }
  });
});

describe('publicSiteUrl', () => {
  it('uses the public domain', () => {
    expect(LIVE_SITE_URL).toBe('https://sabesfinance.lk');
    expect(publicSiteUrl({})).toBe(LIVE_SITE_URL);
    expect(publicSiteUrl()).toBe(LIVE_SITE_URL);
  });

  it('ignores the address the page was opened from', () => {
    expect(publicSiteUrl({ hostname: 'localhost', origin: 'http://localhost:3000' })).toBe(LIVE_SITE_URL);
    expect(publicSiteUrl({ hostname: 'sabeshcapital.vercel.app', origin: 'https://sabeshcapital.vercel.app' })).toBe(LIVE_SITE_URL);
  });

  it('lets NEXT_PUBLIC_SITE_URL win and drops trailing slashes', () => {
    expect(publicSiteUrl({ envUrl: 'https://custom.example.lk/' })).toBe('https://custom.example.lk');
  });
});
