// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageRowActionsMenu } from '@/components/sidebar/page-row-actions-menu';
import type { FlatPageNode } from '@/lib/pages/tree';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

const node = {
  id: '11111111-1111-1111-1111-111111111111',
  parentId: null,
  title: 'Doc',
  spaceId: null,
  depth: 0,
  icon: null,
} as unknown as FlatPageNode;

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/pages/tree') {
        return new Response(
          JSON.stringify({
            nodes: [
              {
                id: '22222222-2222-2222-2222-222222222222',
                parentId: null,
                title: 'Target',
                icon: null,
                depth: 0,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PageRowActionsMenu — Move-To integration', () => {
  it('opening the menu and selecting Move to… shows the picker, and a destination move refreshes', async () => {
    render(<PageRowActionsMenu node={node} />);
    // Open the `…` dropdown. Radix DropdownMenu opens on keyboard activation in
    // jsdom (it gates the trigger on pointer events); same pattern as
    // tests/components/sidebar/page-row-actions-menu.test.tsx.
    const trigger = screen.getByLabelText('pageRow.actions');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    // Select the Move-to item (radix menuitem selects on click/Enter).
    fireEvent.click(await screen.findByRole('menuitem', { name: 'pageMenu.moveTo' }));
    // Picker dialog opens and loads destinations.
    await waitFor(() => expect(screen.getByText('Target')).toBeTruthy());
    fireEvent.click(screen.getByText('Target'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
