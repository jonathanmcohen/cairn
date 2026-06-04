// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

// Importing the Sidebar module pulls in the auth/db chain (auth/config calls
// getDb() at module eval, which validates env). Unit tests don't load `.env`,
// so seed the minimal env before the dynamic import so parseEnv() passes and we
// can assert on the exported className contract.
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/cairn_test';
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-0123456789';
process.env.NEXTAUTH_URL ??= 'http://localhost:3000';

describe('sidebar shell (#207)', () => {
  it('pins the desktop aside to the viewport top so it never scrolls away', async () => {
    const { SIDEBAR_ASIDE_CLASS } = await import('@/components/sidebar');
    expect(SIDEBAR_ASIDE_CLASS).toContain('md:sticky');
    expect(SIDEBAR_ASIDE_CLASS).toContain('top-0');
    expect(SIDEBAR_ASIDE_CLASS).toContain('self-start');
    expect(SIDEBAR_ASIDE_CLASS).toContain('h-screen');
  });
});
