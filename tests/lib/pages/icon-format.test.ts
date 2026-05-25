import { describe, expect, it } from 'vitest';
import { formatIcon, parseIcon, type ParsedIcon } from '@/lib/pages/icon-format';

describe('parseIcon', () => {
  it('returns null for null/empty', () => {
    expect(parseIcon(null)).toBeNull();
    expect(parseIcon('')).toBeNull();
  });

  it('parses an emoji:: prefix', () => {
    expect(parseIcon('emoji::🪨')).toEqual({ kind: 'emoji', value: '🪨' });
  });

  it('parses a file:: prefix with a uuid', () => {
    expect(parseIcon('file::11111111-1111-1111-1111-111111111111')).toEqual({
      kind: 'file',
      value: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('treats a legacy plain value as emoji (back-compat)', () => {
    expect(parseIcon('🪨')).toEqual({ kind: 'emoji', value: '🪨' });
  });

  it('rejects a file:: with non-uuid value (treats as legacy emoji)', () => {
    expect(parseIcon('file::not-a-uuid')).toEqual({ kind: 'emoji', value: 'file::not-a-uuid' });
  });
});

describe('formatIcon', () => {
  it('serializes both kinds with the right prefix', () => {
    expect(formatIcon({ kind: 'emoji', value: '🪨' } as ParsedIcon)).toBe('emoji::🪨');
    expect(
      formatIcon({ kind: 'file', value: '22222222-2222-2222-2222-222222222222' } as ParsedIcon),
    ).toBe('file::22222222-2222-2222-2222-222222222222');
  });

  it('roundtrips parse → format', () => {
    const stored = 'emoji::📘';
    expect(formatIcon(parseIcon(stored)!)).toBe(stored);
  });
});
