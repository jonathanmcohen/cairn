import { describe, expect, it } from 'vitest';
import { awarenessToUsers } from '@/lib/collab/presence';

function states(entries: [number, unknown][]) {
  // biome-ignore lint/suspicious/noExplicitAny: test fixtures mimic raw awareness states
  return new Map<number, any>(entries);
}

describe('awarenessToUsers', () => {
  it('returns remote users, excluding the local client id', () => {
    const map = states([
      [1, { user: { id: 'me', name: 'Me', color: 'hsl(1, 70%, 50%)' } }],
      [2, { user: { id: 'u2', name: 'Ada', color: 'hsl(2, 70%, 50%)' } }],
    ]);
    const users = awarenessToUsers(map, 1);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 'u2', name: 'Ada' });
  });

  it('dedupes the same user across multiple tabs/clients by id', () => {
    const map = states([
      [2, { user: { id: 'u2', name: 'Ada', color: 'c' } }],
      [3, { user: { id: 'u2', name: 'Ada', color: 'c' } }],
      [4, { user: { id: 'u3', name: 'Bo', color: 'c' } }],
    ]);
    const users = awarenessToUsers(map, 1);
    expect(users.map((u) => u.id).sort()).toEqual(['u2', 'u3']);
  });

  it('skips states with no user payload', () => {
    const map = states([
      [2, {}],
      [3, { user: null }],
      [4, { user: { id: 'u4', name: 'Cy', color: 'c' } }],
    ]);
    expect(awarenessToUsers(map, 1).map((u) => u.id)).toEqual(['u4']);
  });

  it('skips user payloads missing an id', () => {
    const map = states([[2, { user: { name: 'NoId', color: 'c' } }]]);
    expect(awarenessToUsers(map, 1)).toEqual([]);
  });

  it('orders deterministically by id (stable avatar stack)', () => {
    const map = states([
      [2, { user: { id: 'zed', name: 'Z', color: 'c' } }],
      [3, { user: { id: 'amy', name: 'A', color: 'c' } }],
    ]);
    expect(awarenessToUsers(map, 1).map((u) => u.id)).toEqual(['amy', 'zed']);
  });

  it('returns empty for an empty map', () => {
    expect(awarenessToUsers(states([]), 1)).toEqual([]);
  });
});
