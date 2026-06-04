// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// v0.9.9 Plan O #59/#238 — focus mode hides the sidebar; the hot-edge strip +
// pin toggle reveal it via a `data-reveal-sidebar` attribute on the html root
// without exiting focus mode.
function render(ui: ReactNode) {
  return rtlRender(
    <I18nProvider locale="en" messages={enMessages as never}>
      {ui}
    </I18nProvider>,
  );
}

beforeEach(() => {
  document.documentElement.classList.remove('cairn-focus-mode');
  document.documentElement.removeAttribute('data-reveal-sidebar');
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-reveal-sidebar');
  document.body.innerHTML = '';
});

function enterFocus() {
  fireEvent.click(screen.getByRole('button', { name: /focus mode/i }));
}

describe('<SidebarHotEdge> (focus-mode sidebar reveal)', () => {
  it('renders a hover strip + pin toggle only while focus mode is on', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    expect(document.querySelector('[data-sidebar-hot-edge]')).toBeNull();
    enterFocus();
    expect(document.querySelector('[data-sidebar-hot-edge]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /pin sidebar/i })).toBeDefined();
  });

  it('hover enter sets data-reveal-sidebar=true, leave clears it', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    enterFocus();
    const strip = document.querySelector('[data-sidebar-hot-edge]') as HTMLElement;
    fireEvent.mouseEnter(strip);
    expect(document.documentElement.getAttribute('data-reveal-sidebar')).toBe('true');
    fireEvent.mouseLeave(strip);
    expect(document.documentElement.getAttribute('data-reveal-sidebar')).not.toBe('true');
  });

  it('pin keeps the sidebar revealed even after mouseLeave', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    enterFocus();
    const pin = screen.getByRole('button', { name: /pin sidebar/i });
    fireEvent.click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    const strip = document.querySelector('[data-sidebar-hot-edge]') as HTMLElement;
    fireEvent.mouseEnter(strip);
    fireEvent.mouseLeave(strip);
    expect(document.documentElement.getAttribute('data-reveal-sidebar')).toBe('true');
  });

  it('leaving focus mode removes data-reveal-sidebar from the root', () => {
    render(
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>,
    );
    enterFocus();
    const strip = document.querySelector('[data-sidebar-hot-edge]') as HTMLElement;
    fireEvent.mouseEnter(strip);
    expect(document.documentElement.getAttribute('data-reveal-sidebar')).toBe('true');
    // exit focus mode via the in-header focus toggle (exact name avoids the
    // fixed "Exit focus mode" button that also matches /focus mode/i)
    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(document.documentElement.getAttribute('data-reveal-sidebar')).not.toBe('true');
  });
});
