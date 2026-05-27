import { describe, expect, it } from 'vitest';
import { formatForViewer, parseInput } from '@/lib/datetime/format';

describe('DST edge cases', () => {
  it('spring-forward: 2026-03-08 02:30 America/New_York does not exist — Luxon picks the post-jump instant', () => {
    const iso = parseInput({ date: '2026-03-08', time: '02:30', tz: 'America/New_York' });
    // 02:30 EST does not exist; Luxon resolves to 03:30 EDT == 07:30 UTC.
    expect(iso).toBe('2026-03-08T07:30:00.000Z');
  });

  it('fall-back: 2026-11-01 01:30 America/New_York is ambiguous; Luxon picks the earlier (EDT) by default', () => {
    const iso = parseInput({ date: '2026-11-01', time: '01:30', tz: 'America/New_York' });
    // 01:30 EDT == 05:30 UTC (the earlier instant).
    expect(iso).toBe('2026-11-01T05:30:00.000Z');
  });

  it('format across tz preserves wall clock semantics', () => {
    // 2026-12-25 00:00 in Pacific/Auckland (+13) == 2026-12-24 11:00 UTC.
    const iso = parseInput({ date: '2026-12-25', time: '00:00', tz: 'Pacific/Auckland' });
    expect(formatForViewer(iso, 'Pacific/Auckland', 'yyyy-LL-dd HH:mm', 'UTC')).toBe(
      '2026-12-24 11:00',
    );
  });
});
