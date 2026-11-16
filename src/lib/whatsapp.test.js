import { describe, it, expect } from 'vitest';
import { whatsappAppUrl, whatsappWebUrl, isMobileDevice, appendBankDetails } from './whatsapp.js';
import { BANK_ACCOUNTS, formatBankDetailsText } from './bankAccounts.js';

describe('whatsapp links', () => {
  it('builds an app link with the message encoded, and no web page involved', () => {
    const url = whatsappAppUrl({ text: 'ரூ 1,000\nline two & more' });
    expect(url.startsWith('whatsapp://send?text=')).toBe(true);
    expect(url).not.toContain('http');
    expect(decodeURIComponent(url.split('text=')[1])).toBe('ரூ 1,000\nline two & more');
  });

  it('includes the phone when given', () => {
    expect(whatsappAppUrl({ phone: '94771234567', text: 'Hi' })).toBe('whatsapp://send?phone=94771234567&text=Hi');
    expect(whatsappWebUrl({ phone: '94771234567', text: 'Hi' })).toBe('https://wa.me/94771234567?text=Hi');
  });

  it('works without a phone or text', () => {
    expect(whatsappAppUrl()).toBe('whatsapp://send');
    expect(whatsappWebUrl()).toBe('https://wa.me/');
  });
});

describe('isMobileDevice', () => {
  it('detects iPhone, iPad and Android', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })).toBe(true);
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });

  it('treats computers as not mobile', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 })).toBe(false);
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isMobileDevice()).toBe(false);
  });
});

describe('bank details in a message', () => {
  it('lists every account with its number, and the copy link last', () => {
    const text = formatBankDetailsText(BANK_ACCOUNTS, 'https://example.test/pay');
    for (const a of BANK_ACCOUNTS) {
      expect(text).toContain(a.accountNumber);
      expect(text).toContain(`*${a.bank}*`);
    }
    expect(text.endsWith('https://example.test/pay')).toBe(true);
  });

  it('shows holder and branch only when set', () => {
    const text = formatBankDetailsText(
      [{ id: 'a', label: 'x', bank: 'Test Bank', accountNumber: '111' }, { id: 'b', label: 'y', bank: 'Other Bank', holder: 'A Person', branch: 'Town', accountNumber: '222' }],
      ''
    );
    expect(text).toContain('*Test Bank*\n111');
    expect(text).toContain('*Other Bank*\nA Person\nTown branch\n222');
    expect(text).not.toContain('http');
  });

  it('appends the bank block at the bottom, after the original text', () => {
    const out = appendBankDetails('NOTICE LINE 1\nNOTICE LINE 2', { payUrl: 'https://example.test/pay' });
    expect(out.startsWith('NOTICE LINE 1\nNOTICE LINE 2\n\n')).toBe(true);
    expect(out.indexOf('NOTICE LINE 2')).toBeLessThan(out.indexOf(BANK_ACCOUNTS[0].accountNumber));
    expect(out.endsWith('https://example.test/pay')).toBe(true);
  });
});
