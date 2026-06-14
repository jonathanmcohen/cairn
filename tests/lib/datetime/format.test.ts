import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { absoluteLocal, formatForViewer, parseInput, relativeFromNow } from '@/lib/datetime/format';

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

describe('relativeFromNow', () => {
  const base = DateTime.fromISO('2026-06-14T12:00:00Z');

  it('phrases a past instant relative to the injected base', () => {
    expect(relativeFromNow('2026-06-11T12:00:00Z', base)).toBe('3 days ago');
    expect(relativeFromNow('2026-06-14T10:00:00Z', base)).toBe('2 hours ago');
  });

  it('phrases a future instant', () => {
    expect(relativeFromNow('2026-06-16T12:00:00Z', base)).toBe('in 2 days');
  });

  it('returns the raw value unchanged when the ISO is unparseable', () => {
    expect(relativeFromNow('not-a-date', base)).toBe('not-a-date');
  });
});

describe('absoluteLocal', () => {
  it('renders a full local date+time for the hover affordance', () => {
    // DATETIME_MED includes month, day, year and the time — assert the parts
    // that are tz/locale-stable rather than an exact string.
    const out = absoluteLocal('2026-06-11T12:00:00Z');
    expect(out).toContain('2026');
    expect(out).toMatch(/Jun/);
  });

  it('returns the raw value unchanged when the ISO is unparseable', () => {
    expect(absoluteLocal('nope')).toBe('nope');
  });
});
