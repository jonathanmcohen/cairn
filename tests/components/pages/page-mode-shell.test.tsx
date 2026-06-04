// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_MODE_STORAGE_KEY, PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// v0.9.4 #104: PageModeToggles now reads i18n labels via useT(), so every
// render must sit under an <I18nProvider>. Shadow testing-library's render
// with a provider-wrapping variant so the existing call sites are unchanged
// and the button accessible-names resolve to the real en labels the
// getByRole({ name: /focus mode/i }) queries match against.
function render(ui: ReactNode) {
  return rtlRender(
    <I18nProvider locale="en" messages={enMessages as never}>
      {ui}
    </I18nProvider>,
  );
}

beforeEach(() => {
  document.documentElement.classList.remove('cairn-focus-mode');
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('<PageModeShell>', () => {
  it('renders children (the toggles now live inside the body, not a slot)', () => {
    render(
      <PageModeShell>
        <div data-testid="hdr" />
        <div data-testid="body" />
      </PageModeShell>,
    );
    expect(screen.getByTestId('hdr')).toBeDefined();
    expect(screen.getByTestId('body')).toBeDefined();
  });

  it('clicking the focus toggle adds the cairn-focus-mode class on the root + persists to localStorage', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    const focusBtn = screen.getByRole('button', { name: /focus mode/i });
    expect(focusBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(focusBtn);
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    expect(focusBtn.getAttribute('aria-pressed')).toBe('true');
    const stored = window.localStorage.getItem(PAGE_MODE_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as { focus: boolean; reader: boolean };
    expect(parsed.focus).toBe(true);
  });

  it('reader toggle flips data-reader on the shell root', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
        <span data-testid="mode" />
      </PageModeShell>,
    );
    const readerBtn = screen.getByRole('button', { name: /reader mode/i });
    expect(readerBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(readerBtn);
    expect(document.querySelector('[data-page-mode-shell][data-reader="true"]')).not.toBeNull();
    expect(readerBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('reads initial focus + reader from localStorage on mount', () => {
    window.localStorage.setItem(
      PAGE_MODE_STORAGE_KEY,
      JSON.stringify({ focus: true, reader: true }),
    );
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    expect(document.querySelector('[data-page-mode-shell][data-reader="true"]')).not.toBeNull();
    // exact name: focus mode is on, so the fixed "Exit focus mode" button is
    // also mounted and would otherwise also match /focus mode/i (Plan O #58).
    expect(screen.getByRole('button', { name: 'Focus mode' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Reader mode' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  // a8 #17 regression guard — the duplicate top-right control box reopened in
  // the v0.9.3 deploy (stale build artifact: the image predated c8f4619). The
  // source is correct and singular; this guard ensures the shell never
  // re-introduces its own floating toggles slot. With a single <PageModeToggles>
  // among the children there must be EXACTLY two mode buttons (focus + reader),
  // never four (which a second mount would produce).
  it('renders exactly one focus + one reader toggle (no duplicate control box)', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
        <div data-testid="body" />
      </PageModeShell>,
    );
    expect(screen.getAllByRole('button', { name: /focus mode/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /reader mode/i })).toHaveLength(1);
  });

  it('the shell itself renders no mode toggles without an explicit <PageModeToggles> child', () => {
    render(
      <PageModeShell>
        <div data-testid="body" />
      </PageModeShell>,
    );
    expect(screen.queryByRole('button', { name: /focus mode/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reader mode/i })).toBeNull();
  });

  // v0.9.9 Plan O #63/#247 — navigation to a different page starts fresh.
  it('resets focus + reader when pageId changes', () => {
    const { rerender } = rtlRender(
      <I18nProvider locale="en" messages={enMessages as never}>
        <PageModeShell pageId="a">
          <PageModeToggles />
        </PageModeShell>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reader mode' }));
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    expect(document.querySelector('[data-page-mode-shell][data-reader="true"]')).not.toBeNull();

    rerender(
      <I18nProvider locale="en" messages={enMessages as never}>
        <PageModeShell pageId="b">
          <PageModeToggles />
        </PageModeShell>
      </I18nProvider>,
    );
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(false);
    expect(document.querySelector('[data-page-mode-shell][data-reader="true"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Focus mode' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Reader mode' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('does NOT reset when re-rendered with the same pageId', () => {
    const { rerender } = rtlRender(
      <I18nProvider locale="en" messages={enMessages as never}>
        <PageModeShell pageId="a">
          <PageModeToggles />
        </PageModeShell>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    rerender(
      <I18nProvider locale="en" messages={enMessages as never}>
        <PageModeShell pageId="a">
          <PageModeToggles />
        </PageModeShell>
      </I18nProvider>,
    );
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
  });

  it('removes the focus-mode class on unmount', () => {
    const { unmount } = render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /focus mode/i }));
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(false);
  });
});
