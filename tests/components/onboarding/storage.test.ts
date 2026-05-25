// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasOnboarded,
  markOnboarded,
  resetOnboardingForTests,
} from '@/components/onboarding/storage';

beforeEach(() => {
  resetOnboardingForTests();
});

describe('onboarding storage', () => {
  it('returns false when the key is absent', () => {
    expect(hasOnboarded('ws-1')).toBe(false);
  });

  it('markOnboarded flips the key to true', () => {
    markOnboarded('ws-1');
    expect(hasOnboarded('ws-1')).toBe(true);
  });

  it('isolates per-workspace (ws-1 onboarded ≠ ws-2 onboarded)', () => {
    markOnboarded('ws-1');
    expect(hasOnboarded('ws-1')).toBe(true);
    expect(hasOnboarded('ws-2')).toBe(false);
  });

  it('survives multiple reads (idempotent)', () => {
    markOnboarded('ws-1');
    expect(hasOnboarded('ws-1')).toBe(true);
    expect(hasOnboarded('ws-1')).toBe(true);
  });

  it('hasOnboarded returns false when localStorage is unavailable (SSR-style)', () => {
    const original = globalThis.localStorage;
    // @ts-expect-error force-undefined to simulate SSR
    delete (globalThis as { localStorage?: Storage }).localStorage;
    try {
      expect(hasOnboarded('ws-1')).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
      });
    }
  });
});
