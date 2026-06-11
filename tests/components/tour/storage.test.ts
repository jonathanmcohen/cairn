// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasSeenTour,
  markTourSeen,
  resetTourForTests,
  TOUR_SEEN_WILDCARD_KEY,
  TOUR_VERSION,
  tourSeenKey,
} from '@/components/tour/storage';

beforeEach(() => {
  resetTourForTests();
});

describe('tour storage (F3 seen-marker version semantics)', () => {
  it('returns false when the key is absent', () => {
    expect(hasSeenTour('ws-1')).toBe(false);
  });

  it('markTourSeen flips the marker to seen', () => {
    markTourSeen('ws-1');
    expect(hasSeenTour('ws-1')).toBe(true);
  });

  it('stores the TOUR_VERSION string under cairn:tour-seen:<workspaceId>', () => {
    markTourSeen('ws-1');
    expect(localStorage.getItem(tourSeenKey('ws-1'))).toBe(TOUR_VERSION);
  });

  it('returns true ONLY for the current TOUR_VERSION (a stale version re-shows)', () => {
    localStorage.setItem(tourSeenKey('ws-1'), '0');
    expect(hasSeenTour('ws-1')).toBe(false);
    localStorage.setItem(tourSeenKey('ws-1'), TOUR_VERSION);
    expect(hasSeenTour('ws-1')).toBe(true);
  });

  it('isolates per-workspace (ws-1 seen does not mark ws-2)', () => {
    markTourSeen('ws-1');
    expect(hasSeenTour('ws-1')).toBe(true);
    expect(hasSeenTour('ws-2')).toBe(false);
  });

  it('honors the test-harness wildcard key for every workspace', () => {
    localStorage.setItem(TOUR_SEEN_WILDCARD_KEY, TOUR_VERSION);
    expect(hasSeenTour('ws-1')).toBe(true);
    expect(hasSeenTour('ws-2')).toBe(true);
  });

  it('wildcard key with a stale version does NOT suppress', () => {
    localStorage.setItem(TOUR_SEEN_WILDCARD_KEY, '0');
    expect(hasSeenTour('ws-1')).toBe(false);
  });

  it('hasSeenTour returns false when localStorage is unavailable (SSR-style)', () => {
    const original = globalThis.localStorage;
    delete (globalThis as { localStorage?: Storage }).localStorage;
    try {
      expect(hasSeenTour('ws-1')).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
      });
    }
  });
});
