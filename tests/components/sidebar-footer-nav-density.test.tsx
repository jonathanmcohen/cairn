// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

vi.mock('@/components/sidebar/review-due-counter', () => ({ ReviewDueCounter: () => null }));
vi.mock('@/components/sidebar/study-link', () => ({ StudyLink: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('footer-nav density (#130)', () => {
  it('renders utility links at 13px density token with pointer-gated height', () => {
    render(<SidebarFooterNav version="0.9.13" />);
    const favorites = screen.getByRole('link', { name: 'Favorites' });
    // Density token present
    expect(favorites.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(favorites.className).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(favorites.className).toContain('tracking-[0.1px]');
    // Pointer-gated height: desktop ~28px, touch 44px
    expect(favorites.className).toContain('min-h-[28px]');
    expect(favorites.className).toContain('pointer-coarse:min-h-11');
    // MUST NOT carry a bare min-h-11 (that defeats the pointer gate)
    expect(favorites.className).not.toMatch(/(^|\s)min-h-11(\s|$)/);
    // No text-sm outlier
    expect(favorites.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });

  it('renders Sign out button with pointer-gated height', () => {
    render(<SidebarFooterNav version="0.9.13" />);
    const signOut = screen.getByRole('button', { name: /sign out/i });
    expect(signOut.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(signOut.className).toContain('min-h-[28px]');
    expect(signOut.className).toContain('pointer-coarse:min-h-11');
    expect(signOut.className).not.toMatch(/(^|\s)min-h-11(\s|$)/);
  });
});
