// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams('new=1'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import { PageTitleInput } from '@/components/page-title-input';

afterEach(() => {
  cleanup();
  mocks.searchParams = new URLSearchParams('new=1');
});

describe('PageTitleInput new-page mode (?new=1)', () => {
  it('autofocuses and selects the title on mount', () => {
    render(<PageTitleInput pageId="p1" initial="" />);
    const input = screen.getByPlaceholderText('Untitled') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('renders the localized naming nudge and a template link while blank', () => {
    render(<PageTitleInput pageId="p1" initial="" />);
    expect(screen.getByText('Give your page a name to get started.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Use a template' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/templates/gallery');
  });
});
