// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyFavorites, EmptyFlashcardsDue, EmptyTrash } from '@/components/empty-state/variants';

afterEach(cleanup);

describe('empty-state variant icons + CTAs', () => {
  it('EmptyFavorites renders an icon + headline', () => {
    const { container } = render(<EmptyFavorites />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('No favorites yet')).toBeTruthy();
  });

  it('EmptyTrash renders an icon + headline', () => {
    const { container } = render(<EmptyTrash />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('Trash is empty')).toBeTruthy();
  });

  it('EmptyFlashcardsDue renders an icon + headline + CTA link to /', () => {
    const { container } = render(<EmptyFlashcardsDue />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('No cards due')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Browse pages' });
    expect(cta.getAttribute('href')).toBe('/');
  });
});
