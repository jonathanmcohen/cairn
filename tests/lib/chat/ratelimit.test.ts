import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, resetRateLimitForTests } from '@/lib/chat/ratelimit';

beforeEach(() => {
  resetRateLimitForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('checkRateLimit', () => {
  it('allows up to 30 in a 60s window', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await checkRateLimit({ workspaceId: 'w1' });
      expect(r.allowed).toBe(true);
    }
    const r31 = await checkRateLimit({ workspaceId: 'w1' });
    expect(r31.allowed).toBe(false);
  });

  it('isolates per workspace', async () => {
    for (let i = 0; i < 30; i++) await checkRateLimit({ workspaceId: 'w1' });
    const r = await checkRateLimit({ workspaceId: 'w2' });
    expect(r.allowed).toBe(true);
  });

  it('resets after the window via fake timers', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 30; i++) await checkRateLimit({ workspaceId: 'w1' });
    expect((await checkRateLimit({ workspaceId: 'w1' })).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect((await checkRateLimit({ workspaceId: 'w1' })).allowed).toBe(true);
  });

  it('honors a custom limit', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit({ workspaceId: 'w3', limit: 5 });
      expect(r.allowed).toBe(true);
    }
    const denied = await checkRateLimit({ workspaceId: 'w3', limit: 5 });
    expect(denied.allowed).toBe(false);
  });
});
