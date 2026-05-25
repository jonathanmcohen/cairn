// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmptyBacklinks,
  EmptyDbTable,
  EmptyFavorites,
  EmptyInbox,
  EmptyNotifications,
  EmptyPageTree,
  EmptyRecents,
  EmptySearch,
} from '@/components/empty-state/variants';

afterEach(() => {
  cleanup();
});

describe('Empty-state variants', () => {
  it('<EmptyPageTree> shows the page-tree headline + CTA', () => {
    render(<EmptyPageTree />);
    expect(screen.getByRole('heading', { name: /no pages yet/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /create a page/i })).toBeTruthy();
  });

  it('<EmptySearch> has no CTA (search has no per-feature action)', () => {
    render(<EmptySearch />);
    expect(screen.getByRole('heading', { name: /no matches found/i })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('<EmptyDbTable> calls onAddRow when its CTA button is clicked', () => {
    const handler = vi.fn();
    render(<EmptyDbTable onAddRow={handler} />);
    const btn = screen.getByRole('button', { name: /add a row/i });
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('<EmptyNotifications> renders headline + guidance and no CTA', () => {
    render(<EmptyNotifications />);
    expect(screen.getByRole('heading', { name: /caught up/i })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('<EmptyFavorites> renders headline + guidance and no CTA', () => {
    render(<EmptyFavorites />);
    expect(screen.getByRole('heading', { name: /no favorites yet/i })).toBeTruthy();
  });

  it('<EmptyInbox> renders headline + guidance and no CTA (capture is keyboard-driven)', () => {
    render(<EmptyInbox />);
    expect(screen.getByRole('heading', { name: /your inbox is empty/i })).toBeTruthy();
    expect(screen.getByText(/cmd\+shift\+n/i)).toBeTruthy();
  });

  it('<EmptyBacklinks> renders headline + guidance', () => {
    render(<EmptyBacklinks />);
    expect(screen.getByRole('heading', { name: /no backlinks yet/i })).toBeTruthy();
  });

  it('<EmptyRecents> renders headline + guidance', () => {
    render(<EmptyRecents />);
    expect(screen.getByRole('heading', { name: /no recent pages/i })).toBeTruthy();
  });
});
