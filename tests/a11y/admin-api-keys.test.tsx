// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatRow } from '@/app/(app)/settings/admin/api-keys/pat-row';
import { Sparkline } from '@/app/(app)/settings/admin/api-keys/sparkline';

// PatRow imports useRouter from next/navigation; outside the App-Router
// runtime there's no router-mounted context, so stub it for this JSDOM smoke.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

/**
 * JSDOM component-level a11y smoke for the v0.9.0 G1 P10 PAT admin dashboard.
 * The project's full WCAG 2.1 AA gate runs via Playwright + @axe-core/playwright
 * in tests/a11y/*.spec.ts (see tests/a11y/v07-routes.spec.ts) — this file is
 * the unit-level companion: cheap structural checks (role, label, focusable)
 * that catch regressions without bringing up a browser.
 *
 * Note: `vitest-axe` is intentionally NOT a dep — the plan said "verify before
 * adding" and we follow the project convention of Playwright axe-runs only.
 */

afterEach(() => {
  cleanup();
});

describe('a11y: admin API-keys components (JSDOM smoke)', () => {
  it('Sparkline exposes role=img + aria-label with semantic content', () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toMatch(/requests/i);
    // No nested interactive content (sparkline should not have any focusable
    // descendants — it's a decoration with a label, not a control).
    expect(container.querySelector('button, a, [tabindex]')).toBeNull();
  });

  it('Sparkline degenerate (empty values) is still a labeled svg', () => {
    const { container } = render(<Sparkline values={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBeTruthy();
  });

  it('PatRow renders a labeled, keyboard-reachable button', () => {
    const { getByRole } = render(
      <PatRow tokenId="11111111-1111-1111-1111-111111111111" name="my-token" />,
    );
    const btn = getByRole('button', { name: /reset quota/i });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('disabled')).toBeNull();
    // Default <button> is implicitly tab-stop (no negative tabindex).
    expect(btn.getAttribute('tabindex')).not.toBe('-1');
  });
});
