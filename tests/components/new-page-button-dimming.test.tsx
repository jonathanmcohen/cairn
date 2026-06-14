// @vitest-environment jsdom
// v0.10.2 S5 — the PAGES-header dimming (opacity-30 + group-hover reveal) is
// INJECTED by pages-section via the className prop, never baked into
// NewPageButton: the button is reused on the empty-workspace landing where it
// must render at full opacity. A default render gaining opacity-30 means the
// dimming leaked into the component and every call site went dim.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewPageButton } from '@/components/new-page-button';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/pwa/offline-context', () => ({
  useActionAllowed: () => true,
}));

describe('item S5 — NewPageButton dimming stays caller-injected', () => {
  afterEach(cleanup);

  it('default render is NOT dimmed (no opacity-30)', () => {
    render(<NewPageButton />);
    const btn = screen.getByRole('button', { name: 'New page' });
    expect(btn.className).not.toContain('opacity-30');
  });

  it('merges a caller-provided dimming className (pages-section path)', () => {
    render(<NewPageButton className="opacity-30 group-hover/pages:opacity-100" />);
    const btn = screen.getByRole('button', { name: 'New page' });
    expect(btn.className).toContain('opacity-30');
    expect(btn.className).toContain('h-11'); // base sizing preserved by cn merge
  });
});
