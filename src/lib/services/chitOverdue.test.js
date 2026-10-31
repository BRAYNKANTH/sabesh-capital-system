import { describe, it, expect } from 'vitest';
import { overdueDays, toDateString, OVERDUE_AFTER_DAYS } from './chitOverdue.js';

describe('overdueDays', () => {
  it('is zero until the grace period has passed', () => {
    expect(overdueDays('2026-10-01', '2026-10-01')).toBe(0);
    expect(overdueDays('2026-10-01', '2026-10-08')).toBe(0); // exactly 7 days later: still on time
  });

  it('counts the days after the grace period', () => {
    expect(overdueDays('2026-10-01', '2026-10-09')).toBe(1);
    expect(overdueDays('2026-10-01', '2026-10-18')).toBe(10);
  });

  it('handles month and year ends', () => {
    expect(overdueDays('2026-12-28', '2027-01-10')).toBe(13 - OVERDUE_AFTER_DAYS);
    expect(overdueDays('2026-02-26', '2026-03-10')).toBe(12 - OVERDUE_AFTER_DAYS);
  });

  it('is zero for a future auction date and for missing dates', () => {
    expect(overdueDays('2026-11-30', '2026-10-31')).toBe(0);
    expect(overdueDays(null, '2026-10-31')).toBe(0);
    expect(overdueDays('2026-10-01', undefined)).toBe(0);
  });

  it('accepts a custom grace period', () => {
    expect(overdueDays('2026-10-01', '2026-10-04', 0)).toBe(3);
    expect(overdueDays('2026-10-01', '2026-10-04', 3)).toBe(0);
  });
});

describe('toDateString', () => {
  it('reads a Date in local time and a date string as is', () => {
    expect(toDateString(new Date(2026, 9, 5))).toBe('2026-10-05');
    expect(toDateString('2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
    expect(toDateString('nonsense')).toBeNull();
    expect(toDateString(null)).toBeNull();
  });
});
