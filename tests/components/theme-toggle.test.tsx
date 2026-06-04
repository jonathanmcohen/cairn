// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/theme-toggle';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

const setTheme = vi.fn();
let current = 'system';
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: current, setTheme }),
}));

function renderToggle() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <ThemeToggle />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  setTheme.mockClear();
  current = 'system';
});

describe('ThemeToggle', () => {
  it('cycles system → dark on click', () => {
    current = 'system';
    renderToggle();
    fireEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
  it('cycles dark → light on click', () => {
    current = 'dark';
    renderToggle();
    fireEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenCalledWith('light');
  });
  it('cycles light → system on click', () => {
    current = 'light';
    renderToggle();
    fireEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenCalledWith('system');
  });
  it('labels the button for the current state (system shows System theme)', () => {
    current = 'system';
    renderToggle();
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('System theme');
  });
});
