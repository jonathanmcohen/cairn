// @vitest-environment jsdom
/**
 * v0.9.16 #143 — switching workspaces must do a HARD navigation.
 *
 * A soft client nav (router.push/refresh) does NOT refetch the client-cached
 * sidebar queries (page tree, saved searches, flashcard queue, workspace
 * meta/badge), so they keep showing the OLD workspace until a manual reload.
 * The fix replaces the soft nav with `window.location.assign('/')` (a hard
 * navigation) so every query refetches under the new workspace cookie.
 *
 * This suite asserts: (a) the switch POST is sent with the target id, and
 * (b) a hard navigation to '/' fires — NOT router.push.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
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
vi.mock('@/components/workspace-create-dialog', () => ({
  WorkspaceCreateDialog: ({ open }: { open: boolean }) =>
    open ? createElement('div', { role: 'dialog', 'aria-label': 'New workspace' }) : null,
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
});

describe('<WorkspaceSwitcher> hard navigation on switch (#143)', () => {
  it('POSTs the target id then hard-navigates to "/" (not router.push)', async () => {
    // Mock window.location safely: replace `assign` and intercept `href` writes.
    const assign = vi.fn();
    let href = 'http://localhost/templates';
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        assign,
        get href() {
          return href;
        },
        set href(v: string) {
          href = v;
        },
      },
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    try {
      render(
        createElement(WorkspaceSwitcher, {
          workspaces: [
            { id: 'a', name: 'Acme', role: 'owner', icon: null },
            { id: 'b', name: 'Beta', role: 'editor', icon: null },
          ],
          activeId: 'a',
        }),
      );

      fireEvent.pointerDown(screen.getByRole('button', { name: /switch workspace/i }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole('menuitem', { name: /beta/i }));

      // let the switchTo promise chain settle
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // (a) POST /api/workspaces/switch with the target id
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/switch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ workspaceId: 'b' }),
        }),
      );

      // (b) a hard navigation to '/' fired, NOT a soft router.push
      const hardNavToRoot = assign.mock.calls.some(([url]) => url === '/') || href === '/';
      expect(hardNavToRoot).toBe(true);
      expect(push).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    }
  });
});
