import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

describe('legacy /admin/chat-bridge redirects (#186)', () => {
  it('root redirects into the settings hub', async () => {
    const mod = await import('@/app/(app)/admin/chat-bridge/page');
    try {
      await mod.default();
    } catch {}
    expect(redirect).toHaveBeenCalledWith('/settings/admin/chat-bridge');
  });
  it('channels redirects into the settings hub', async () => {
    redirect.mockClear();
    const mod = await import('@/app/(app)/admin/chat-bridge/channels/page');
    try {
      await mod.default();
    } catch {}
    expect(redirect).toHaveBeenCalledWith('/settings/admin/chat-bridge/channels');
  });
});
