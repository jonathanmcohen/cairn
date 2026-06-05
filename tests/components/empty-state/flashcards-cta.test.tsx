// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyFlashcardsDue } from '@/components/empty-state/variants';

// next/link renders a plain <a href> under jsdom; stub to keep it simple.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('EmptyFlashcardsDue CTA', () => {
  it('links the CTA to /search, not to / (#116)', () => {
    const { container } = render(<EmptyFlashcardsDue />);
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/search');
    expect(link?.getAttribute('href')).not.toBe('/');
  });
});
