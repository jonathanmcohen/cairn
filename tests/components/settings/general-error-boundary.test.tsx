// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import SettingsError from '@/app/(app)/settings/error';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

describe('settings <error> boundary (#1)', () => {
  it('renders a recoverable error with a retry button instead of a bare digest', () => {
    const reset = vi.fn();
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <SettingsError error={new Error('column "icon" does not exist')} reset={reset} />
      </I18nProvider>,
    );
    expect(screen.getByText(enMessages['settings.error.title'])).toBeTruthy();
    const retry = screen.getByRole('button', { name: enMessages['settings.error.retry'] });
    expect(retry).toBeTruthy();
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
