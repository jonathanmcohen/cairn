// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

afterEach(cleanup);

describe('<WorkspaceSwitcher> row avatars', () => {
  it('shows an initial badge for each workspace row', () => {
    render(
      <WorkspaceSwitcher workspaces={[{ id: 'a', name: 'Acme', role: 'owner' }]} activeId="a" />,
    );
    // The trigger label "Acme" is present; the row badge renders the initial "A".
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  });
});
