// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildPaletteActions, type PaletteContext } from '@/lib/palette/actions';

function fakeCtx(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    router: { push: vi.fn(), refresh: vi.fn() },
    currentPageId: null,
    currentUserId: 'u1',
    setTheme: vi.fn(),
    currentTheme: 'light',
    toast: vi.fn(),
    openNotifications: vi.fn(),
    ...overrides,
  };
}

describe('buildPaletteActions', () => {
  it('includes all the always-available actions', () => {
    const actions = buildPaletteActions(fakeCtx());
    const ids = actions.map((a) => a.id);
    // Spec-required ids:
    expect(ids).toContain('nav.home');
    expect(ids).toContain('page.new');
    expect(ids).toContain('search.open');
    expect(ids).toContain('theme.toggle');
    expect(ids).toContain('nav.settings.account');
    expect(ids).toContain('nav.settings.workspace');
    expect(ids).toContain('nav.settings.security');
    expect(ids).toContain('nav.settings.developer');
    expect(ids).toContain('nav.settings.notifications');
    expect(ids).toContain('nav.favorites');
    expect(ids).toContain('nav.inbox');
    expect(ids).toContain('nav.notifications');
    expect(ids).toContain('nav.templates');
    expect(ids).toContain('workspace.switch');
    expect(ids).toContain('auth.signout');
  });

  it('omits "copy page link" + "export pdf" when currentPageId is null', () => {
    const actions = buildPaletteActions(fakeCtx({ currentPageId: null }));
    const ids = actions.map((a) => a.id);
    expect(ids).not.toContain('page.copyLink');
    expect(ids).not.toContain('page.exportPdf');
  });

  it('includes "copy page link" + "export pdf" when currentPageId is set', () => {
    const actions = buildPaletteActions(fakeCtx({ currentPageId: 'page-xyz' }));
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('page.copyLink');
    expect(ids).toContain('page.exportPdf');
  });

  it('nav.home dispatches via router.push("/")', () => {
    const ctx = fakeCtx();
    const actions = buildPaletteActions(ctx);
    const home = actions.find((a) => a.id === 'nav.home');
    home?.run();
    expect(ctx.router.push).toHaveBeenCalledWith('/');
  });

  it('theme.toggle calls setTheme with the opposite of currentTheme', () => {
    const ctx = fakeCtx({ currentTheme: 'light' });
    const actions = buildPaletteActions(ctx);
    actions.find((a) => a.id === 'theme.toggle')?.run();
    expect(ctx.setTheme).toHaveBeenCalledWith('dark');
  });

  it('theme.toggle in dark goes to light', () => {
    const ctx = fakeCtx({ currentTheme: 'dark' });
    const actions = buildPaletteActions(ctx);
    actions.find((a) => a.id === 'theme.toggle')?.run();
    expect(ctx.setTheme).toHaveBeenCalledWith('light');
  });

  it('page.copyLink calls clipboard.writeText and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    const ctx = fakeCtx({ currentPageId: 'pg1' });
    const actions = buildPaletteActions(ctx);
    actions.find((a) => a.id === 'page.copyLink')?.run();
    // run() may be sync (fire-and-forget); flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0] as string).toMatch(/\/pages\/pg1$/);
  });

  it('nav.notifications routes to /notifications', () => {
    const ctx = fakeCtx();
    const actions = buildPaletteActions(ctx);
    actions.find((a) => a.id === 'nav.notifications')?.run();
    expect(ctx.router.push).toHaveBeenCalledWith('/notifications');
  });

  it('auth.signout POSTs to /api/auth/signout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const ctx = fakeCtx();
    const actions = buildPaletteActions(ctx);
    actions.find((a) => a.id === 'auth.signout')?.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/signout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
