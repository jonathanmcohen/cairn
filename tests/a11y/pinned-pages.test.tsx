// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinnedManager } from '@/app/(app)/settings/workspace/pinned-pages/pinned-manager';
import { PinnedSection } from '@/components/sidebar/pinned-section';

// PinnedManager imports useRouter from next/navigation; outside the App-Router
// runtime there's no router-mounted context, so stub it for this JSDOM smoke.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * v0.9.0 G2 P12 — JSDOM-level a11y smoke for the workspace-pinned UI.
 *
 * The full WCAG 2.1 AA gate runs via Playwright + @axe-core/playwright in
 * tests/a11y/*.spec.ts. This file is the unit-level companion — cheap
 * structural checks (roles, labels, focusable controls) that catch
 * regressions without spinning up a browser. `vitest-axe` is intentionally
 * NOT a dep (see tests/a11y/admin-api-keys.test.tsx).
 */
describe('a11y: workspace-pinned UI (JSDOM smoke)', () => {
  it('PinnedSection (no pins) renders nothing — no empty landmark', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ pins: [] }), { status: 200 })),
    );
    const { container } = render(<PinnedSection />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pinned-section"]')).toBeNull();
    });
  });

  it('PinnedSection (with pins) exposes a Pinned heading + link list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              pins: [
                {
                  pageId: '00000000-0000-0000-0000-000000000001',
                  title: 'Runbook',
                  icon: null,
                  position: 0,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const { container } = render(<PinnedSection />);
    expect(await screen.findByText('Pinned')).toBeTruthy();
    // Pin is a real link (a element) so keyboard/screen-reader users can
    // tab into it.
    const link = await screen.findByRole('link', { name: /Runbook/ });
    expect(link.getAttribute('href')).toBe('/pages/00000000-0000-0000-0000-000000000001');
    expect(container.querySelectorAll('a').length).toBeGreaterThan(0);
  });

  it('PinnedManager renders an Add-a-pin label + an empty-state message', () => {
    render(<PinnedManager initial={[]} />);
    // The input has an associated <Label>, satisfying the
    // form-control-has-an-accessible-name rule.
    const input = screen.getByLabelText(/Add a pin/i);
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe('input');
    expect(screen.getByText(/No pinned pages yet/i)).toBeTruthy();
  });

  it('PinnedManager row exposes drag-handle aria-label + a Remove button', () => {
    render(
      <PinnedManager
        initial={[
          {
            pageId: '00000000-0000-0000-0000-0000000000aa',
            title: 'Onboarding',
            icon: null,
            position: 0,
            pinnedBy: '00000000-0000-0000-0000-0000000000bb',
            pinnedAt: new Date(),
          },
        ]}
      />,
    );
    // Drag handle is button-shaped + labeled (passes button-name + role).
    const drag = screen.getByRole('button', { name: /Drag handle/i });
    expect(drag.tagName.toLowerCase()).toBe('button');
    // Remove button exists + is accessible by name.
    const remove = screen.getByRole('button', { name: /Remove/i });
    expect(remove.tagName.toLowerCase()).toBe('button');
  });
});
