// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { __resetRegistered, ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { I18nProvider } from '@/lib/i18n/provider';
import { resetRegistry } from '@/lib/shortcuts/registry';
import enMessages from '../../messages/en.json';

/**
 * v0.9.0 G6 P33 — JSDOM component-level a11y smoke for the focus + reader
 * page-mode toggles. Mirrors the pattern used by other v0.9 a11y component
 * tests (tests/a11y/admin-api-keys.test.tsx, pinned-pages.test.tsx) — cheap
 * structural checks that catch aria-pressed + label + touch-target
 * regressions without spinning up a browser.
 *
 * v0.9.4 #104 — the toggles now read i18n labels via useT(), so the render
 * helper wraps them in <I18nProvider>. New assertions guard the i18n label +
 * native title tooltip parity and the stronger pressed-state ring utility.
 */

beforeEach(() => {
  // v0.9.9 Plan O #57/#236 — populate the shortcut registry so shortcutFor()
  // resolves the focus/reader key glyphs the toggle tooltips append.
  resetRegistry();
  __resetRegistered();
  ensureAppShortcuts();
});

afterEach(() => {
  cleanup();
  resetRegistry();
  __resetRegistered();
});

function renderToggles() {
  return render(
    <I18nProvider locale="en" messages={enMessages as never}>
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>
    </I18nProvider>,
  );
}

describe('a11y: page-mode toggles (JSDOM smoke)', () => {
  it('both toggles expose role=button, aria-label, and aria-pressed', () => {
    renderToggles();
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
    renderToggles();
    const focus = screen.getByRole('button', { name: /focus mode/i });
    const reader = screen.getByRole('button', { name: /reader mode/i });
    const cls = (el: Element) => el.getAttribute('class') ?? '';
    expect(cls(focus)).toMatch(/min-h-\[44px\]/);
    expect(cls(focus)).toMatch(/min-w-\[44px\]/);
    expect(cls(reader)).toMatch(/min-h-\[44px\]/);
    expect(cls(reader)).toMatch(/min-w-\[44px\]/);
  });

  it('reader toggle exposes an i18n label + a native title tooltip', () => {
    renderToggles();
    const reader = screen.getByRole('button', { name: /reader/i });
    // accessible name (aria-label) and tooltip (title) both present
    expect(reader.getAttribute('aria-label')).toBeTruthy();
    expect(reader.getAttribute('title')).toBeTruthy();
    // aria-pressed reflects state and starts off
    expect(reader.getAttribute('aria-pressed')).toBe('false');
  });

  it('both toggle tooltips advertise their keyboard shortcut glyph (#57/#236)', () => {
    renderToggles();
    const focus = screen.getByRole('button', { name: /focus mode/i });
    const reader = screen.getByRole('button', { name: /reader mode/i });
    // mac glyphs (⌘⇧.) OR non-mac text (Ctrl+Shift+.) depending on platform.
    expect(focus.getAttribute('title')).toMatch(/⌘⇧\.|Ctrl\+Shift\+\./);
    expect(reader.getAttribute('title')).toMatch(/⌘⇧R|Ctrl\+Shift\+R/);
  });

  it('reader toggle carries an explicit pressed-state ring utility', () => {
    renderToggles();
    const reader = screen.getByRole('button', { name: /reader/i });
    // the active treatment is wired via an aria-pressed-driven ring class
    expect(reader.getAttribute('class')).toMatch(/aria-pressed:ring/);
  });
});
