// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_MODE_STORAGE_KEY, PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';

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
    expect(screen.getByRole('button', { name: /focus mode/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /reader mode/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
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
