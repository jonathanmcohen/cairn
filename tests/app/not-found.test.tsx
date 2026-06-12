// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotFound from '@/app/not-found';

// v0.10.2 P17 made NotFound an async server component that resolves the
// locale via next/headers — mock both stores (no request scope in jsdom).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

afterEach(cleanup);

describe('app-root <NotFound>', () => {
  it('renders a themed 404 with a link home', async () => {
    render(await NotFound());
    expect(screen.getByText('404')).toBeTruthy();
    const home = screen.getByRole('link', { name: /home|back/i });
    expect(home.getAttribute('href')).toBe('/');
  });

  it('renders the P17 recovery search form posting to /search', async () => {
    render(await NotFound());
    const input = screen.getByRole('searchbox', { name: 'Search pages' });
    expect(input.getAttribute('name')).toBe('q');
    const form = input.closest('form');
    expect(form?.getAttribute('action')).toBe('/search');
    expect(form?.getAttribute('method')).toBe('get');
  });
});
