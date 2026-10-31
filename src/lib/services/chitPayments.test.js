import { describe, it, expect } from 'vitest';
import { balanceDue, isFullyPaid, checkInstalment, round2 } from './chitPayments.js';

describe('balanceDue', () => {
  it('is what is left of the amount due', () => {
    expect(balanceDue(14250, 8000)).toBe(6250);
    expect(balanceDue('14250.00', '0')).toBe(14250);
  });

  it('is zero once fully covered, never negative', () => {
    expect(balanceDue(14250, 14250)).toBe(0);
    expect(balanceDue(14250, 15000)).toBe(0);
  });

  it('is unknown before the auction sets the amount due', () => {
    expect(balanceDue(null, 2000)).toBeNull();
    expect(balanceDue(undefined, 0)).toBeNull();
  });

  it('ignores floating point noise', () => {
    expect(balanceDue(0.3, 0.1 + 0.2)).toBe(0);
  });
});

describe('isFullyPaid', () => {
  it('is false for a part payment', () => {
    expect(isFullyPaid(14250, 2000)).toBe(false);
  });

  it('is true once the total reaches the amount due', () => {
    expect(isFullyPaid(14250, 14250)).toBe(true);
    expect(isFullyPaid('14250.00', '14250.00')).toBe(true);
  });

  it('is never true before the amount due is known', () => {
    expect(isFullyPaid(null, 99999)).toBe(false);
  });
});

describe('checkInstalment', () => {
  it('accepts a part payment and leaves the rest as a balance', () => {
    expect(checkInstalment(2000, 14250, 0)).toEqual({ amount: 2000 });
    expect(checkInstalment(6250, 14250, 8000)).toEqual({ amount: 6250 });
  });

  it('rejects an amount larger than the balance', () => {
    const r = checkInstalment(7000, 14250, 8000);
    expect(r.amount).toBeUndefined();
    expect(r.error).toContain('more than the balance');
  });

  it('rejects any more once fully paid', () => {
    expect(checkInstalment(100, 14250, 14250).error).toMatch(/already fully paid/);
  });

  it('rejects zero, negative and missing amounts', () => {
    expect(checkInstalment(0, 14250, 0).error).toBe('Enter the amount collected.');
    expect(checkInstalment(-5, 14250, 0).error).toBe('Enter the amount collected.');
    expect(checkInstalment('', 14250, 0).error).toBe('Enter the amount collected.');
  });

  it('has no cap before the auction sets the amount due', () => {
    expect(checkInstalment(2000, null, 0)).toEqual({ amount: 2000 });
    expect(checkInstalment(90000, null, 2000)).toEqual({ amount: 90000 });
  });

  it('rejects an absurdly large amount (a typing mistake)', () => {
    expect(checkInstalment(99999999999, null, 0).error).toMatch(/too large/);
  });

  it('rounds to whole cents', () => {
    expect(checkInstalment('1000.005', 5000, 0).amount).toBe(round2(1000.005));
  });
});
