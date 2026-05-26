import { describe, expect, it } from 'vitest';
import { parseScimFilter, ScimFilterError } from '@/lib/sso/scim';

describe('parseScimFilter', () => {
  it('returns null for no filter', () => {
    expect(parseScimFilter(undefined)).toBeNull();
    expect(parseScimFilter('')).toBeNull();
  });

  it('parses userName eq', () => {
    const r = parseScimFilter('userName eq "alice@example.com"');
    expect(r).toEqual({ kind: 'userName-eq', value: 'alice@example.com' });
  });

  it('parses userName eq with single quotes', () => {
    const r = parseScimFilter("userName eq 'alice@example.com'");
    expect(r).toEqual({ kind: 'userName-eq', value: 'alice@example.com' });
  });

  it('parses meta.lastModified gt', () => {
    const r = parseScimFilter('meta.lastModified gt "2024-01-01T00:00:00Z"');
    expect(r).toEqual({ kind: 'lastModified-gt', value: new Date('2024-01-01T00:00:00Z') });
  });

  it('rejects unsupported operators (ne, co, sw, ew, gt on userName)', () => {
    expect(() => parseScimFilter('userName ne "x"')).toThrow(ScimFilterError);
    expect(() => parseScimFilter('userName co "x"')).toThrow(ScimFilterError);
    expect(() => parseScimFilter('userName gt "x"')).toThrow(ScimFilterError);
  });

  it('rejects logical combinations (and/or)', () => {
    expect(() => parseScimFilter('userName eq "a" and active eq true')).toThrow(ScimFilterError);
    expect(() => parseScimFilter('userName eq "a" or userName eq "b"')).toThrow(ScimFilterError);
  });

  it('rejects parens / grouping', () => {
    expect(() => parseScimFilter('(userName eq "a")')).toThrow(ScimFilterError);
  });

  it('rejects malformed syntax', () => {
    expect(() => parseScimFilter('userNameAlmost')).toThrow(ScimFilterError);
    expect(() => parseScimFilter('userName eq')).toThrow(ScimFilterError);
  });
});
