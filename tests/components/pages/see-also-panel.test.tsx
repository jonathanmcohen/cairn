// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

vi.mock('@/lib/search/see-also', () => ({
  findRelatedPages: vi.fn(async () => [
    { id: 'a', title: 'Alpha', icon: 'emoji::🅰️', snippet: 'alpha body', score: 0.95 },
    { id: 'b', title: 'Beta', icon: null, snippet: 'beta body', score: 0.82 },
    {
      id: 'c',
      title: 'Gamma',
      icon: 'file::11111111-1111-1111-1111-111111111111',
      snippet: 'gamma body',
      score: 0.7,
    },
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

  it('renders the parsed emoji, never the raw shortcode prefix', async () => {
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    const ui = await SeeAlsoPanel({ pageId: 'src', viewerUserId: 'u1' });
    const { container } = render(<>{ui}</>);
    // The bare unicode emoji is rendered…
    expect(screen.getByText('🅰️')).toBeTruthy();
    // …and the `emoji::` / `file::` prefix never reaches the DOM.
    expect(container.textContent ?? '').not.toContain('emoji::');
    expect(container.textContent ?? '').not.toContain('file::');
  });

  it('shows a neutral placeholder for file-backed icons', async () => {
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    const ui = await SeeAlsoPanel({ pageId: 'src', viewerUserId: 'u1' });
    render(<>{ui}</>);
    // Gamma's file:: icon collapses to the 🖼️ placeholder.
    expect(screen.getByText('🖼️')).toBeTruthy();
  });

  it('renders a relative match-strength meter per related page (#219)', async () => {
    const mod = await import('@/lib/search/see-also');
    const spy = mod.findRelatedPages as unknown as ReturnType<typeof vi.fn>;
    spy.mockResolvedValueOnce([
      { id: 'a', title: 'Alpha', icon: null, snippet: '', score: 0.95, relativeScore: 1 },
      { id: 'b', title: 'Beta', icon: null, snippet: '', score: 0.82, relativeScore: 0 },
    ]);
    const { SeeAlsoPanel } = await import('@/components/pages/see-also-panel');
    const ui = await SeeAlsoPanel({ pageId: 'src', viewerUserId: 'u1' });
    render(<>{ui}</>);
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(2);
    expect(meters[0]?.getAttribute('aria-valuenow')).toBe('100');
    expect(meters[1]?.getAttribute('aria-valuenow')).toBe('0');
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
