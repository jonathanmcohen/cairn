// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationsPicker } from '@/components/pages/translations-picker';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PAGE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

function mockFetch(initial: {
  translations: Array<{ id: string; title: string; locale: string }>;
}) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (!init || init.method !== 'POST') {
      return Promise.resolve({ ok: true, json: async () => initial });
    }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('<TranslationsPicker>', () => {
  it('renders heading and a linked-translation list item after mount', async () => {
    mockFetch({ translations: [{ id: 'p2', title: 'Hola', locale: 'es' }] });
    render(<TranslationsPicker pageId={PAGE_ID} canEdit={false} />);
    expect(screen.getByRole('heading', { name: 'Translations' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Hola')).toBeTruthy());
    expect(screen.getByText('es')).toBeTruthy();
  });

  it('shows the empty state to editors when there are no translations', async () => {
    mockFetch({ translations: [] });
    render(<TranslationsPicker pageId={PAGE_ID} canEdit />);
    await waitFor(() => expect(screen.getByText('No linked translations.')).toBeTruthy());
  });

  // v0.10.3 Q-6 — a read-only viewer with nothing linked should see no panel at
  // all, instead of an always-present empty "Translations" section.
  it('renders nothing for a viewer when there are no translations', async () => {
    mockFetch({ translations: [] });
    render(<TranslationsPicker pageId={PAGE_ID} canEdit={false} />);
    // After the fetch resolves the empty viewer panel collapses to null.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Translations' })).toBeNull());
    expect(screen.queryByText('No linked translations.')).toBeNull();
  });

  it('hides the link inputs/button when not editable but translations exist', async () => {
    mockFetch({ translations: [{ id: 'p2', title: 'Hola', locale: 'es' }] });
    render(<TranslationsPicker pageId={PAGE_ID} canEdit={false} />);
    await waitFor(() => expect(screen.getByText('Hola')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Link translation' })).toBeNull();
  });

  it('POSTs the entered canonical id + locale on link', async () => {
    const fetchMock = mockFetch({ translations: [] });
    render(<TranslationsPicker pageId={PAGE_ID} canEdit />);
    await waitFor(() => expect(screen.getByText('No linked translations.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Canonical page ID'), {
      target: { value: 'canon-123' },
    });
    fireEvent.change(screen.getByLabelText('Locale (e.g. es)'), { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link translation' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PAGE_ID}/translations`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ canonicalPageId: 'canon-123', locale: 'fr' }),
        }),
      );
    });
  });
});
