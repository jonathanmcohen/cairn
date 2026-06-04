// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from '@/components/editor/outline-panel';

vi.mock('@/lib/editor/headings', () => ({
  collectHeadings: () => [
    { id: 'h1', level: 1, text: 'Intro' },
    { id: 'h2', level: 2, text: 'Sub' },
    { id: 'h3', level: 3, text: 'Deep' },
  ],
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

function makeEditor() {
  const dom = document.createElement('div');
  for (const tag of ['h1', 'h2', 'h3']) dom.appendChild(document.createElement(tag));
  return {
    state: { doc: { toJSON: () => ({}) } },
    view: { dom },
    on: () => {},
    off: () => {},
  } as unknown as import('@tiptap/react').Editor;
}

describe('<OutlinePanel> drawer (#234)', () => {
  it('renders a right-side drawer (fixed inset-y-0 end-0), not the w-56 popover', () => {
    const { container } = render(<OutlinePanel editor={makeEditor()} onClose={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('fixed');
    expect(root.className).toContain('inset-y-0');
    expect(root.className).toContain('end-0');
    expect(root.className).not.toContain('w-56');
    expect(root.className).not.toContain('absolute');
  });

  it('lists nested H1/H2/H3 with increasing indentation', () => {
    render(<OutlinePanel editor={makeEditor()} onClose={vi.fn()} />);
    const intro = screen.getByRole('button', { name: 'Intro' });
    const sub = screen.getByRole('button', { name: 'Sub' });
    const deep = screen.getByRole('button', { name: 'Deep' });
    const padOf = (btn: HTMLElement) =>
      Number((btn.parentElement as HTMLElement).style.paddingInlineStart.replace('px', ''));
    expect(padOf(intro)).toBe(0);
    expect(padOf(sub)).toBeGreaterThan(padOf(intro));
    expect(padOf(deep)).toBeGreaterThan(padOf(sub));
  });

  it('scrolls to the clicked heading and exposes a close button', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    render(<OutlinePanel editor={makeEditor()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sub' }));
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.getByLabelText('Hide outline')).toBeTruthy();
  });
});
