// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

// ReviewDueCounter + ThemeToggle pull in client hooks that error under jsdom.
vi.mock('@/components/sidebar/review-due-counter', () => ({ ReviewDueCounter: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return {
    useT: () => (key: string, params?: Record<string, string | number>) => {
      const raw = en[key] ?? key;
      return params
        ? raw.replace(/\{(\w+)\}/g, (m, n) => (params[n] !== undefined ? String(params[n]) : m))
        : raw;
    },
  };
});

afterEach(cleanup);

describe('<SidebarFooterNav> version link', () => {
  it('renders the version as an accessible external link with a discernible name', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    const link = screen.getByRole('link', { name: /9\.9\.9|release notes/i });
    expect(link.getAttribute('href')).toContain('9.9.9');
    expect(link.getAttribute('target')).toBe('_blank');
    // AA: must carry a PERSISTENT underline affordance (a bare `underline`
    // token, not the round-1 hover-only `hover:underline`) + a visible focus
    // ring, so non-hover/keyboard users perceive it as a link.
    expect(link.className).toMatch(/(^|\s)underline(\s|$)/);
    expect(link.className).toMatch(/focus-visible:ring/);
  });
});
