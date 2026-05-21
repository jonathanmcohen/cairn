import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, parseListQuery } from '@/lib/api/pagination';

describe('cursor pagination', () => {
  it('round-trips an opaque cursor', () => {
    const c = encodeCursor({ createdAt: '2026-05-21T00:00:00.000Z', id: 'abc' });
    const back = decodeCursor(c);
    expect(back).toEqual({ createdAt: '2026-05-21T00:00:00.000Z', id: 'abc' });
  });

  it('returns null for a missing or garbage cursor', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
  });

  it('clamps limit to [1,100] with a default of 25', () => {
    const url = (q: string) => new URL(`http://localhost/api/v1/pages${q}`);
    expect(parseListQuery(url('')).limit).toBe(25);
    expect(parseListQuery(url('?limit=500')).limit).toBe(100);
    expect(parseListQuery(url('?limit=0')).limit).toBe(1);
    expect(parseListQuery(url('?limit=10')).limit).toBe(10);
    expect(
      parseListQuery(url(`?cursor=${encodeCursor({ createdAt: 'x', id: 'y' })}`)).cursor,
    ).toEqual({
      createdAt: 'x',
      id: 'y',
    });
  });
});
