// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeForm } from '@/app/(app)/settings/account/theme/theme-form';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

function renderForm() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <ThemeForm initial={{ accent: 'default', fontFamily: 'system', pageWidth: 'wide' }} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ThemeForm live preview', () => {
  it('renders 44px accent swatches', () => {
    renderForm();
    const blue = screen.getByRole('button', { name: 'Blue' });
    expect(blue.className).toContain('h-11');
    expect(blue.className).toContain('w-11');
  });
  it('updates the live-preview container --primary when an accent is picked', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    const preview = screen.getByTestId('theme-preview');
    expect(preview.style.getPropertyValue('--primary')).toBe('217 91% 60%');
  });
});
