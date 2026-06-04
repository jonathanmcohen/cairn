// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json' with { type: 'json' };

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({ userId: 'u1', workspaceId: 'w1', role: 'admin' })),
}));

// The page resolves locale from cookies()+headers(); the global setup mock only
// stubs cookies(). Provide both so resolveLocale runs (defaults to en here).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

describe('workspace export label consistency (#187)', () => {
  it('uses the single "Export" term in the heading', async () => {
    const { default: Page } = await import(
      '@/app/(app)/settings/workspace/export-static-site/page'
    );
    const ui = await Page();
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        {ui}
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Export' })).toBeTruthy();
    // no stale "Static-site export" wording remains as the H1
    expect(screen.queryByRole('heading', { level: 1, name: 'Static-site export' })).toBeNull();
  });
});
