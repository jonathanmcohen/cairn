// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

vi.mock('@/lib/search/see-also', () => ({
  findRelatedPages: vi.fn(async () => [
    { id: 'a', title: 'Alpha', icon: '🅰️', snippet: 'alpha body', score: 0.95 },
    { id: 'b', title: 'Beta', icon: null, snippet: 'beta body', score: 0.82 },
  ]),
}));
vi.mock('@/db/client', () => ({ getDb: () => ({}) }));

describe('<SeeAlsoPanel>', () => {
  it('renders one item per related page', async () => {
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    const ui = await SeeAlsoPanel({ pageId: 'src', viewerUserId: 'u1' });
    render(<>{ui}</>);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    // Snippet rendered for each item.
    expect(screen.getByText(/alpha body/)).toBeTruthy();
    expect(screen.getByText(/beta body/)).toBeTruthy();
  });

  it('renders an accessible heading and a nav landmark', async () => {
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    const ui = await SeeAlsoPanel({ pageId: 'src', viewerUserId: 'u1' });
    render(<>{ui}</>);
    expect(screen.getByRole('heading', { name: /see also/i })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /see also/i })).toBeTruthy();
  });

  it('returns null when there are no related pages', async () => {
    const mod = await import('@/lib/search/see-also');
    (mod.findRelatedPages as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    const ui = await SeeAlsoPanel({ pageId: 'src', viewerUserId: 'u1' });
    expect(ui).toBeNull();
  });

  it('forwards publicViewer=true when no viewerUserId is given', async () => {
    const mod = await import('@/lib/search/see-also');
    const spy = mod.findRelatedPages as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();
    spy.mockResolvedValueOnce([{ id: 'x', title: 'X', icon: null, snippet: 's', score: 0.5 }]);
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    await SeeAlsoPanel({ pageId: 'src', viewerUserId: null, publicViewer: true });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pageId: 'src', publicViewer: true, viewerUserId: null }),
    );
  });
});
