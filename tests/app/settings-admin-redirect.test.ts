import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

describe('/settings/admin index (#5 verify)', () => {
  it('redirects to the audit leaf', async () => {
    const mod = await import('@/app/(app)/settings/admin/page');
    try {
      mod.default();
    } catch {
      // redirect() throws NEXT_REDIRECT in app router; mock swallows, ignore.
    }
    expect(redirect).toHaveBeenCalledWith('/settings/admin/audit');
  });
});
