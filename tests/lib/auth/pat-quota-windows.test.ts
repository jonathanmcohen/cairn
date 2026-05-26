import { describe, expect, it } from 'vitest';
import {
  dayWindowStart,
  monthWindowStart,
  nextDayBoundarySec,
  nextMonthBoundarySec,
} from '@/lib/auth/pat-quota-windows';

describe('pat-quota-windows', () => {
  it('dayWindowStart pins to UTC midnight', () => {
    const ts = new Date('2026-05-26T13:45:30Z');
    expect(dayWindowStart(ts).toISOString()).toBe('2026-05-26T00:00:00.000Z');
  });

  it('dayWindowStart at the exact UTC midnight is identity', () => {
    const ts = new Date('2026-05-26T00:00:00Z');
    expect(dayWindowStart(ts).toISOString()).toBe('2026-05-26T00:00:00.000Z');
  });

  it('monthWindowStart pins to first of month UTC', () => {
    const ts = new Date('2026-05-26T13:45:30Z');
    expect(monthWindowStart(ts).toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('nextDayBoundarySec returns seconds until next UTC midnight', () => {
    const ts = new Date('2026-05-26T23:59:50Z');
    expect(nextDayBoundarySec(ts)).toBe(10);
  });

  it('nextMonthBoundarySec returns seconds until first of next month UTC', () => {
    const ts = new Date('2026-05-31T23:59:50Z');
    expect(nextMonthBoundarySec(ts)).toBe(10);
  });

  it('nextMonthBoundarySec handles December → January rollover', () => {
    const ts = new Date('2026-12-31T23:59:50Z');
    expect(nextMonthBoundarySec(ts)).toBe(10);
  });
});
