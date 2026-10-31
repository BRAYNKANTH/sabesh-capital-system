import { describe, it, expect } from 'vitest';
import { normalizeCode, suggestCode, chipColors, CODE_MAX_LENGTH } from './chitCode.js';

describe('normalizeCode', () => {
  it('upper-cases and turns spaces into hyphens', () => {
    expect(normalizeCode('  smc 2 ')).toEqual({ code: 'SMC-2' });
    expect(normalizeCode('oct_30')).toEqual({ code: 'OCT_30' });
  });

  it('rejects empty, too long and odd characters', () => {
    expect(normalizeCode('').error).toMatch(/Enter a short code/);
    expect(normalizeCode(null).error).toMatch(/Enter a short code/);
    expect(normalizeCode('A'.repeat(CODE_MAX_LENGTH + 1)).error).toMatch(/at most 12/);
    expect(normalizeCode('SMC!').error).toMatch(/letters, numbers/);
    expect(normalizeCode('-SMC').error).toMatch(/start with a letter or number/);
  });

  it('accepts the longest allowed code', () => {
    expect(normalizeCode('A'.repeat(CODE_MAX_LENGTH))).toEqual({ code: 'A'.repeat(CODE_MAX_LENGTH) });
  });
});

describe('suggestCode', () => {
  it('uses the first letters of the words', () => {
    expect(suggestCode('Sabesh micro credit')).toBe('SMC');
    expect(suggestCode('brayn test')).toBe('BT');
  });

  it('uses the first three letters of a single word', () => {
    expect(suggestCode('Diwali')).toBe('DIW');
  });

  it('ignores punctuation and caps at four words', () => {
    expect(suggestCode('A-1 (big) group, of five')).toBe('ABGO');
  });

  it('falls back to G when the name has no letters or numbers', () => {
    expect(suggestCode('   ')).toBe('G');
    expect(suggestCode('!!!')).toBe('G');
  });

  it('adds -2, -3 when the code is already used, ignoring case', () => {
    expect(suggestCode('Sabesh micro credit', ['SMC'])).toBe('SMC-2');
    expect(suggestCode('Sabesh micro credit', ['smc', 'SMC-2'])).toBe('SMC-3');
    expect(suggestCode('Sabesh micro credit', [null, undefined])).toBe('SMC');
  });

  it('always produces a code that passes the rules', () => {
    for (const name of ['Sabesh micro credit', 'x', 'ABCDEFG HIJ', '123 456', 'a b c d e f']) {
      expect(normalizeCode(suggestCode(name, ['A', 'AB', 'ABC'])).error).toBeUndefined();
    }
  });
});

describe('chipColors', () => {
  it('gives the same colours for the same code, whatever its case', () => {
    expect(chipColors('smc')).toEqual(chipColors('SMC'));
  });

  it('returns a background and text colour', () => {
    expect(chipColors('SMC-2')).toEqual({ bg: expect.stringMatching(/^#/), fg: expect.stringMatching(/^#/) });
  });
});
