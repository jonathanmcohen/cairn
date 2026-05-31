// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBanner } from '@/components/ui/status-banner';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

describe('<StatusBanner>', () => {
  it('error variant uses the destructive token and role=alert', () => {
    renderWithI18n(<StatusBanner variant="error">Boom</StatusBanner>);
    const el = screen.getByRole('alert');
    expect(el.className).toContain('text-destructive');
    expect(el.className).not.toMatch(/text-red-\d/);
    expect(el.textContent).toContain('Boom');
  });

  it('success variant uses the success token and role=status', () => {
    renderWithI18n(<StatusBanner variant="success">Saved</StatusBanner>);
    const el = screen.getByRole('status');
    expect(el.className).toContain('text-success');
    expect(el.className).not.toMatch(/text-green-\d/);
  });

  it('warning variant uses the warning token', () => {
    renderWithI18n(<StatusBanner variant="warning">Careful</StatusBanner>);
    const el = screen.getByRole('status');
    expect(el.className).toContain('text-warning');
  });
});
