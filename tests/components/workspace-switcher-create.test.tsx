// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

// radix DropdownMenu opens on pointer events + uses pointer capture; jsdom omits
// PointerEvent and the capture methods. Polyfill them so the trigger opens.
beforeAll(() => {
  if (!('PointerEvent' in window)) {
    // @ts-expect-error jsdom polyfill
    window.PointerEvent = MouseEvent;
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
// Stub the modal so opening it is observable without IconPicker's browser deps.
vi.mock('@/components/workspace-create-dialog', () => ({
  WorkspaceCreateDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="New workspace" /> : null,
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
});

describe('<WorkspaceSwitcher> create + switch', () => {
  it('opens the create modal instead of prompting', async () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: 'a', name: 'Acme', role: 'owner', icon: null }]}
        activeId="a"
      />,
    );
    // radix opens on pointerdown (left button), not a synthetic click in jsdom.
    fireEvent.pointerDown(screen.getByRole('button', { name: /switch workspace/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /create workspace/i }));
    expect(await screen.findByRole('dialog', { name: /new workspace/i })).toBeTruthy();
  });

  it('hard-navigates to "/" after switching (#143 — lands on workspace home, not /templates)', async () => {
    // #143 changed the soft router.push('/') to a HARD nav via
    // window.location.assign('/') so client-cached sidebar queries refetch under
    // the new workspace cookie. Assert the hard nav fires and push does NOT.
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    try {
      render(
        <WorkspaceSwitcher
          workspaces={[
            { id: 'a', name: 'Acme', role: 'owner', icon: null },
            { id: 'b', name: 'Beta', role: 'editor', icon: null },
          ]}
          activeId="a"
        />,
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
      fireEvent.pointerDown(screen.getByRole('button', { name: /switch workspace/i }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole('menuitem', { name: /beta/i }));
      // allow the switchTo promise chain to settle
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(assign).toHaveBeenCalledWith('/');
      expect(push).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
