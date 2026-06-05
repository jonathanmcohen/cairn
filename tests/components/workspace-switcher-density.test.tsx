// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('workspace-switcher trigger density (#130)', () => {
  it('renders the active-workspace trigger at 13px density token, keeping min-h-11', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'w1', name: 'Homelab', role: 'owner' }]}
        activeId="w1"
      />,
    );
    const trigger = screen.getByText('Homelab').closest('button');
    expect(trigger?.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(trigger?.className).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(trigger?.className).toContain('tracking-[0.1px]');
    expect(trigger?.className).toContain('min-h-11'); // a11y floor intact
    expect(trigger?.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
});
