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
  it('uses the live site when opened on localhost', () => {
    expect(publicSiteUrl({ hostname: 'localhost', origin: 'http://localhost:3000' })).toBe(LIVE_SITE_URL);
  });

  it('uses the address the page is opened from when it is a public host', () => {
    expect(publicSiteUrl({ hostname: 'sabeshcapital.vercel.app', origin: 'https://sabeshcapital.vercel.app' })).toBe('https://sabeshcapital.vercel.app');
    expect(publicSiteUrl({ hostname: 'pay.example.lk', origin: 'https://pay.example.lk' })).toBe('https://pay.example.lk');
  });

  it('lets NEXT_PUBLIC_SITE_URL win everywhere and drops trailing slashes', () => {
    expect(publicSiteUrl({ envUrl: 'https://custom.example.lk/', hostname: 'localhost', origin: 'http://localhost:3000' })).toBe('https://custom.example.lk');
    expect(publicSiteUrl({ envUrl: 'https://custom.example.lk', hostname: 'sabeshcapital.vercel.app', origin: 'https://sabeshcapital.vercel.app' })).toBe('https://custom.example.lk');
  });
});
