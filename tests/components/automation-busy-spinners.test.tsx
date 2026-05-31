// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { TestPanel } from '@/components/automation/builder/test-panel';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, json: async () => ({ result: {}, payload: {} }) } as never),
            50,
          ),
        ),
    ) as never,
  );
});

describe('<TestPanel> spinner', () => {
  it('shows a spinning svg while the dry-run is in flight', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <TestPanel
          body={
            {
              triggerEvent: 'row.created',
              condition: {},
              actionType: 'notify',
              actionConfig: {},
            } as never
          }
        />
      </I18nProvider>,
    );
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    await waitFor(() => expect(btn.querySelector('svg.animate-spin')).toBeTruthy());
  });
});
