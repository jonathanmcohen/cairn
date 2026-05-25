// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from '@/components/empty-state/empty-state';

afterEach(() => {
  cleanup();
});

describe('<EmptyState>', () => {
  it('renders headline + guidance', () => {
    render(<EmptyState headline="Nothing here" guidance="Add something to see it." />);
    expect(screen.getByRole('heading', { name: /nothing here/i })).toBeTruthy();
    expect(screen.getByText(/add something to see it/i)).toBeTruthy();
  });

  it('renders a CTA link when ctaLabel + ctaHref are provided', () => {
    render(
      <EmptyState
        headline="No items"
        guidance="Create one."
        ctaLabel="Create item"
        ctaHref="/items/new"
      />,
    );
    const link = screen.getByRole('link', { name: /create item/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/items/new');
  });

  it('renders a CTA button when ctaLabel + onCta are provided', () => {
    const handler = vi.fn();
    render(
      <EmptyState
        headline="No items"
        guidance="Create one."
        ctaLabel="Create item"
        onCta={handler}
      />,
    );
    expect(screen.getByRole('button', { name: /create item/i })).toBeTruthy();
  });

  it('omits the CTA when only ctaLabel is provided (no href or handler)', () => {
    render(<EmptyState headline="No items" guidance="Nothing to do." ctaLabel="Create item" />);
    expect(screen.queryByRole('link', { name: /create item/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create item/i })).toBeNull();
  });
});
