// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// v0.9.9 Plan O #58/#237 — focus mode hides the in-header toggle, so the shell
// renders a fixed exit-focus banner + floating button while focus is on, and
// Escape also exits. Provider-wrapping render mirrors page-mode-shell.test.tsx.
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

describe('<ExitFocusControl> (rendered by <PageModeShell> in focus mode)', () => {
  it('no exit control when focus mode is off', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    expect(screen.queryByRole('button', { name: /exit focus mode/i })).toBeNull();
  });

  it('shows a fixed exit button + status banner when focus mode is on', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /focus mode/i }));
    expect(screen.getByRole('button', { name: /exit focus mode/i })).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('clicking the exit button leaves focus mode', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    const focusBtn = screen.getByRole('button', { name: /focus mode/i });
    fireEvent.click(focusBtn);
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /exit focus mode/i }));
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(false);
    expect(focusBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('pressing Escape while focused leaves focus mode', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /focus mode/i }));
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.documentElement.classList.contains('cairn-focus-mode')).toBe(false);
  });
});
