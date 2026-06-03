// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FavoritesList } from '@/components/favorites/favorites-list';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

afterEach(cleanup);

function renderList(items: { pageId: string; title: string; icon: string | null }[]) {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <FavoritesList items={items} />
    </I18nProvider>,
  );
}

describe('<FavoritesList>', () => {
  it('renders a link per favorite pointing at the page', () => {
    renderList([
      { pageId: 'p1', title: 'Roadmap', icon: null },
      { pageId: 'p2', title: 'Notes', icon: null },
    ]);
    expect(screen.getByRole('link', { name: /Roadmap/ }).getAttribute('href')).toBe('/pages/p1');
    expect(screen.getByRole('link', { name: /Notes/ }).getAttribute('href')).toBe('/pages/p2');
  });

  it('shows the empty state when there are no favorites', () => {
    // v0.9.9 Plan I (#204) — the empty branch now renders the shared
    // EmptyFavorites variant (icon + headline + Browse-pages CTA) instead of a
    // bare paragraph.
    renderList([]);
    expect(screen.getByText('No favorites yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse pages' }).getAttribute('href')).toBe('/');
  });
});
