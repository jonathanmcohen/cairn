import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({ userId: 'u1', workspaceId: 'w1', role: 'admin' })),
}));
vi.mock('@/db/client', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => [] }) }) }),
}));

describe('settings/admin/chat-bridge (#186)', () => {
  it('exports a default page component at the new path', async () => {
    const mod = await import('@/app/(app)/settings/admin/chat-bridge/page');
    expect(typeof mod.default).toBe('function');
  });
});
