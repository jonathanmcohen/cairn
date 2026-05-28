import { describe, expect, it } from 'vitest';
import { formatForViewer, parseInput } from '@/lib/datetime/format';

describe('formatForViewer', () => {
  it('renders ISO in the viewer tz with the given format', () => {
    // 2026-05-26 15:00 UTC → in America/New_York that's 11:00 EDT.
    expect(
      formatForViewer(
        '2026-05-26T15:00:00Z',
        'America/New_York',
        'yyyy-LL-dd HH:mm',
        'America/New_York',
      ),
    ).toBe('2026-05-26 11:00');
    expect(
      formatForViewer('2026-05-26T15:00:00Z', 'America/New_York', 'yyyy-LL-dd HH:mm', 'UTC'),
    ).toBe('2026-05-26 15:00');
  });

  it('handles tz string fallback gracefully', () => {
    const out = formatForViewer(
      '2026-05-26T15:00:00Z',
      'Etc/UTC',
      'yyyy-LL-dd HH:mm',
      'BOGUS/zone',
    );
    expect(out).toContain('2026-05-26');
  });
});

describe('parseInput', () => {
  it('roundtrips a local-tz date+time into a UTC ISO', () => {
    const iso = parseInput({ date: '2026-05-26', time: '11:00', tz: 'America/New_York' });
    expect(iso).toBe('2026-05-26T15:00:00.000Z');
  });
});
