// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetRecentsClockForTests,
  __setRecentsClockForTests,
  clearRecents,
  getRecents,
  pushRecent,
} from '@/lib/palette/recents';

beforeEach(() => {
  // Clean storage for both test users.
  clearRecents('u1');
  clearRecents('u2');
  __resetRecentsClockForTests();
});

afterEach(() => {
  __resetRecentsClockForTests();
});

describe('recents', () => {
  it('starts empty', () => {
    expect(getRecents('u1')).toEqual([]);
  });

  it('pushRecent inserts at the top', () => {
    pushRecent('u1', 'a');
    pushRecent('u1', 'b');
    expect(getRecents('u1')).toEqual(['b', 'a']);
  });

  it('re-pushing an existing id bumps it to the top (dedup)', () => {
    // Need distinct timestamps so the debounce check passes — advance clock 2s.
    __setRecentsClockForTests(1000);
    pushRecent('u1', 'a');
    __setRecentsClockForTests(3000);
    pushRecent('u1', 'b');
    __setRecentsClockForTests(5000);
    pushRecent('u1', 'a');
    expect(getRecents('u1')).toEqual(['a', 'b']);
  });

  it('caps the stored list at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      __setRecentsClockForTests(1000 + i * 2000);
      pushRecent('u1', `id-${i}`);
    }
    const list = getRecents('u1');
    expect(list.length).toBe(20);
    // Newest-first: id-24 at index 0, id-23 at index 1, …, id-5 at index 19.
    expect(list[0]).toBe('id-24');
    expect(list[19]).toBe('id-5');
  });

  it('debounces repeat pushes of the same id within 1s', () => {
    __setRecentsClockForTests(1000);
    pushRecent('u1', 'a');
    __setRecentsClockForTests(1500); // 500ms later — dropped.
    pushRecent('u1', 'a');
    __setRecentsClockForTests(2200); // 1200ms after the first — accepted.
    pushRecent('u1', 'b');
    expect(getRecents('u1')).toEqual(['b', 'a']);
  });

  it('isolates per-user', () => {
    pushRecent('u1', 'a');
    pushRecent('u2', 'b');
    expect(getRecents('u1')).toEqual(['a']);
    expect(getRecents('u2')).toEqual(['b']);
  });

  it('returns [] when localStorage is unavailable', () => {
    const original = globalThis.localStorage;
    // @ts-expect-error force-undefined to simulate SSR
    delete (globalThis as { localStorage?: Storage }).localStorage;
    try {
      expect(getRecents('u1')).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
      });
    }
  });
});
