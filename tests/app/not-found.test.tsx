// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';

afterEach(cleanup);

describe('app-root <NotFound>', () => {
  it('renders a themed 404 with a link home', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeTruthy();
    const home = screen.getByRole('link', { name: /home|back/i });
    expect(home.getAttribute('href')).toBe('/');
  });
});
