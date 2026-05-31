// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BibliographyToggle } from '@/components/editor/bibliography-toggle';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderToggle(initial: boolean) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <BibliographyToggle pageId="page-1" initialDisabled={initial} />
    </I18nProvider>,
  );
}

describe('BibliographyToggle', () => {
  it('renders an aria-pressed toggle reflecting the bibliography-shown state', () => {
    renderToggle(false);
    const btn = screen.getByRole('button', { name: /Bibliography/i });
    // Not disabled → bibliography shown → pressed.
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('PATCHes disable_bibliography=true when toggled off', async () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole('button', { name: /Bibliography/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/pages/page-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      metadata: { disable_bibliography: true },
    });
    expect(screen.getByRole('button', { name: /Bibliography/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
