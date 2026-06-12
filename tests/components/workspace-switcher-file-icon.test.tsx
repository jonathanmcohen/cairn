// @vitest-environment jsdom
/**
 * v0.10.2 S6 — the switcher chip must render the REAL image when a `file::`
 * icon has a server-minted signed URL (`iconUrl`), and the letter-initial
 * fallback must use the ACCENT color (bg-primary) instead of the old neutral
 * bg-muted. Emoji icons keep today's neutral badge with no <img>.
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

describe('<WorkspaceSwitcher> file-backed icon chip (S6)', () => {
  it('renders the signed image (not the letter) when iconUrl is set', () => {
    const signed = '/api/files/abc?sig=deadbeef&exp=9999999999';
    const { container } = render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner', icon: 'file::abc', iconUrl: signed }]}
        activeId="a"
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(signed);
    expect(screen.queryByText('A')).toBeNull();
  });

  it('renders the letter initial on the accent color when no icon is set', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner', icon: null, iconUrl: null }]}
        activeId="a"
      />,
    );
    const letters = screen.getAllByText('A');
    expect(letters.length).toBeGreaterThan(0);
    for (const letter of letters) {
      const chip = letter.closest('span');
      expect(chip?.className).toContain('bg-primary');
      expect(chip?.className).not.toContain('bg-muted');
    }
  });

  it('keeps the neutral emoji badge with no <img> for emoji icons', () => {
    const { container } = render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner', icon: 'emoji::🚀', iconUrl: null }]}
        activeId="a"
      />,
    );
    expect(screen.getAllByText('🚀').length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
  });
});
