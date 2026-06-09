// @vitest-environment jsdom
/**
 * v0.9.16 #142 — the switcher badge must render the workspace `icon` (an emoji
 * or file glyph), falling back to the letter initial only when no icon is set.
 * Previously it always showed the letter initial and ignored `icon`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('<WorkspaceSwitcher> icon badge (#142)', () => {
  it('renders the emoji icon (not the letter) when icon is set', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner', icon: 'emoji::🚀' }]}
        activeId="a"
      />,
    );
    // The active trigger badge shows the emoji, not the "A" initial.
    expect(screen.getAllByText('🚀').length).toBeGreaterThan(0);
    expect(screen.queryByText('A')).toBeNull();
  });

  it('falls back to the letter initial when no icon is set', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner', icon: null }]}
        activeId="a"
      />,
    );
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  });
});
