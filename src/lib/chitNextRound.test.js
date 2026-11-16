import { describe, it, expect } from 'vitest';
import { nextRoundDays, nextRoundSuggestion } from './chitNextRound.js';

describe('next round days', () => {
  it('matches the real round 4 example (11.75 days)', () => {
    expect(nextRoundDays(1200000, 730000)).toBe(11.75);
    const s = nextRoundSuggestion('2026-11-15', 1200000, 730000);
    expect(s).toEqual({ days: 11.75, earlier: '2026-11-26', later: '2026-11-27' });
  });

  it('whole days give one date', () => {
    expect(nextRoundDays(300000, 30000)).toBe(27);
    const s = nextRoundSuggestion('2026-12-01', 300000, 30000);
    expect(s.earlier).toBe('2026-12-28');
    expect(s.later).toBe('2026-12-28');
  });

  it('no discount is a full cycle; a custom cycle is used', () => {
    expect(nextRoundDays(300000, 0)).toBe(30);
    expect(nextRoundDays(300000, 0, 7)).toBe(7);
  });

  it('rejects bad input', () => {
    expect(nextRoundDays(0, 0)).toBeNull();
    expect(nextRoundDays(1000, -1)).toBeNull();
    expect(nextRoundDays(1000, 2000)).toBeNull();
    expect(nextRoundDays(1000, '')).toBe(30);
  });

  it('handles month and year ends', () => {
    expect(nextRoundSuggestion('2026-12-20', 300000, 0).earlier).toBe('2027-01-19');
  });
});
