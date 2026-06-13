// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashcardsNav } from '@/components/sidebar/flashcards-nav';

// i18n: resolve flat dotted keys against en.json, with plural-suffix support so
// the due-count aria-label (`...dueCount` → `.one`/`.other`) resolves.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return {
    useT:
      () =>
      (key: string, params?: Record<string, string | number>): string => {
        let raw = en[key];
        if (raw === undefined && params && typeof params.count === 'number') {
          raw = en[`${key}.${params.count === 1 ? 'one' : 'other'}`] ?? en[`${key}.other`];
        }
        raw ??= key;
        return params
          ? raw.replace(/\{(\w+)\}/g, (m, n) => (params[n] !== undefined ? String(params[n]) : m))
          : raw;
      },
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockDue(due: unknown[]): void {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ due }) } as Response);
}

describe('<FlashcardsNav>', () => {
  it('always renders the Flashcards parent linking to the overview', async () => {
    mockDue([]);
    render(<FlashcardsNav />);
    const parent = screen.getByRole('link', { name: /^Flashcards/ });
    expect(parent.getAttribute('href')).toBe('/flashcards');
  });

  it('renders the three children (Due now / Manage / Orphans) when expanded', async () => {
    mockDue([]);
    render(<FlashcardsNav />);
    expect(screen.getByRole('link', { name: 'Due now' }).getAttribute('href')).toBe(
      '/flashcards/study',
    );
    expect(screen.getByRole('link', { name: 'Manage flashcards' }).getAttribute('href')).toBe(
      '/flashcards/manage',
    );
    expect(screen.getByRole('link', { name: 'Orphaned cards' }).getAttribute('href')).toBe(
      '/flashcards/orphans',
    );
  });

  it('collapses the children when the chevron toggle is clicked', async () => {
    mockDue([]);
    render(<FlashcardsNav />);
    const toggle = screen.getByRole('button', { name: 'Toggle flashcards menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Due now' })).toBeNull();
  });

  it('shows the due badge with a pluralized aria-label when cards are due', async () => {
    mockDue([{}, {}, {}]);
    render(<FlashcardsNav />);
    const badge = await screen.findByTestId('flashcards-due-badge');
    expect(badge.textContent).toContain('3');
    expect(badge.textContent).toContain('3 cards due');
  });

  it('shows no badge when zero cards are due (always-visible parent, conditional badge)', async () => {
    mockDue([]);
    render(<FlashcardsNav />);
    // Parent is present even at 0 due.
    expect(screen.getByRole('link', { name: /^Flashcards/ })).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/flashcards/due',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    expect(screen.queryByTestId('flashcards-due-badge')).toBeNull();
  });

  it('fails open (no badge) when the due fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    render(<FlashcardsNav />);
    // Parent still renders; no badge ever appears.
    expect(screen.getByRole('link', { name: /^Flashcards/ })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('flashcards-due-badge')).toBeNull();
  });

  it('fails open (no badge) when the due endpoint returns non-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    render(<FlashcardsNav />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('flashcards-due-badge')).toBeNull();
  });
});
