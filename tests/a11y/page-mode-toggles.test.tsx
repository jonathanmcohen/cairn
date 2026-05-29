// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';

/**
 * v0.9.0 G6 P33 — JSDOM component-level a11y smoke for the focus + reader
 * page-mode toggles. Mirrors the pattern used by other v0.9 a11y component
 * tests (tests/a11y/admin-api-keys.test.tsx, pinned-pages.test.tsx) — cheap
 * structural checks that catch aria-pressed + label + touch-target
 * regressions without spinning up a browser.
 */

afterEach(() => {
  cleanup();
});

describe('a11y: page-mode toggles (JSDOM smoke)', () => {
  it('both toggles expose role=button, aria-label, and aria-pressed', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    const focus = screen.getByRole('button', { name: /focus mode/i });
    const reader = screen.getByRole('button', { name: /reader mode/i });
    expect(focus.getAttribute('aria-pressed')).toBe('false');
    expect(reader.getAttribute('aria-pressed')).toBe('false');
    // aria-label is present (not just title) — title alone is not sufficient for AT
    expect(focus.getAttribute('aria-label')).toMatch(/focus mode/i);
    expect(reader.getAttribute('aria-label')).toMatch(/reader mode/i);
    // Default <button>: tab-reachable.
    expect(focus.getAttribute('tabindex')).not.toBe('-1');
    expect(reader.getAttribute('tabindex')).not.toBe('-1');
  });

  it('both toggles carry the 44x44 touch-target Tailwind utility classes', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    const focus = screen.getByRole('button', { name: /focus mode/i });
    const reader = screen.getByRole('button', { name: /reader mode/i });
    const cls = (el: Element) => el.getAttribute('class') ?? '';
    expect(cls(focus)).toMatch(/min-h-\[44px\]/);
    expect(cls(focus)).toMatch(/min-w-\[44px\]/);
    expect(cls(reader)).toMatch(/min-h-\[44px\]/);
    expect(cls(reader)).toMatch(/min-w-\[44px\]/);
  });
});
