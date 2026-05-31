// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { CoverPicker } from '@/components/pages/cover-picker';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: async () => ({}) } as never), 50),
        ),
    ) as never,
  );
});

describe('<CoverPicker> saving state', () => {
  it('disables and spins while a save is in flight', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <CoverPicker pageId="p1" current={{}} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add cover' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use default cover' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use default cover' })).toHaveProperty(
        'disabled',
        true,
      ),
    );
  });
});
