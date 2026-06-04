// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAGE_MODE_STORAGE_KEY,
  PageModeShell,
  resetPageFocusMode,
  usePageMode,
} from '@/components/pages/page-mode-shell';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

function Probe() {
  const { focus, reader } = usePageMode();
  return (
    <span data-testid="probe">
      focus:{String(focus)} reader:{String(reader)}
    </span>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('cairn-focus-mode');
});

afterEach(() => {
  cleanup();
});

describe('resetPageFocusMode', () => {
  it('hydrates the shell from localStorage, then drops focus while preserving reader', async () => {
    window.localStorage.setItem(
      PAGE_MODE_STORAGE_KEY,
      JSON.stringify({ focus: true, reader: true }),
    );

    // v0.9.9 Plan O #58 — focus mode now mounts the i18n-using ExitFocusControl
    // + SidebarHotEdge, so the shell must sit under an <I18nProvider> when focus
    // hydrates true.
    render(
      <I18nProvider locale="en" messages={enMessages as never}>
        <PageModeShell>
          <Probe />
        </PageModeShell>
      </I18nProvider>,
    );

    // Hydrated on mount.
    expect(screen.getByTestId('probe').textContent).toBe('focus:true reader:true');

    await act(async () => {
      resetPageFocusMode();
    });

    // Persisted prefs now have focus:false, reader:true.
    const stored = JSON.parse(window.localStorage.getItem(PAGE_MODE_STORAGE_KEY) ?? '{}');
    expect(stored).toEqual({ focus: false, reader: true });

    // The mounted shell re-rendered with focus dropped, reader preserved.
    expect(screen.getByTestId('probe').textContent).toBe('focus:false reader:true');

    // The root focus class is cleared.
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(false);
  });
});
