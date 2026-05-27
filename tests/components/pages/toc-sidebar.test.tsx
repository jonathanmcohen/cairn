// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TocSidebar } from '@/components/pages/toc-sidebar';

const doc = (children: unknown[]) => ({ type: 'doc', content: children });
const h = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

// jsdom doesn't ship IntersectionObserver; stub it so we can drive entries by
// hand inside tests.
type Cb = (entries: IntersectionObserverEntry[]) => void;
let lastObserverCb: Cb | null = null;
class FakeIO {
  constructor(cb: Cb) {
    lastObserverCb = cb;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}

beforeEach(() => {
  lastObserverCb = null;
  (globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver = FakeIO;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('<TocSidebar>', () => {
  it('renders a navigation landmark with all h1-h4 headings nested', () => {
    render(
      <TocSidebar
        initialDoc={doc([
          h(1, 'One'),
          h(2, 'Two'),
          h(3, 'Three'),
          h(4, 'Four'),
        ])}
      />,
    );
    expect(screen.getByRole('navigation', { name: /table of contents/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'One' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Two' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Three' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Four' })).toBeTruthy();
  });

  it('nests deeper levels under shallower (visual indentation via inline padding)', () => {
    render(
      <TocSidebar initialDoc={doc([h(1, 'L1'), h(2, 'L2'), h(3, 'L3'), h(4, 'L4')])} />,
    );
    // Padding-inline-start grows with level. Inspect the inline style on each
    // <li> wrapper directly — jsdom's getComputedStyle doesn't surface
    // logical properties, but `style.paddingInlineStart` reflects the
    // React-assigned inline value verbatim.
    const li1 = screen.getByRole('link', { name: 'L1' }).parentElement as HTMLElement;
    const li4 = screen.getByRole('link', { name: 'L4' }).parentElement as HTMLElement;
    const ps = (el: HTMLElement) => parseFloat(el.style.paddingInlineStart || '0');
    expect(ps(li4)).toBeGreaterThan(ps(li1));
  });

  it('renders an empty state when the doc has no headings', () => {
    render(<TocSidebar initialDoc={doc([{ type: 'paragraph' }])} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/no headings/i)).toBeTruthy();
  });

  it('marks the active link with aria-current="location" when its heading intersects', () => {
    // Render two headings + corresponding fake DOM targets the observer watches.
    const html = `
      <h1 id="one">One</h1>
      <h2 id="two">Two</h2>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    render(<TocSidebar initialDoc={doc([h(1, 'One'), h(2, 'Two')])} />);
    expect(lastObserverCb).not.toBeNull();

    // Drive an intersection event: heading "two" enters viewport.
    act(() => {
      lastObserverCb?.([
        {
          // biome-ignore lint/style/noNonNullAssertion: test fixture seeded in DOM above.
          target: document.getElementById('two')!,
          isIntersecting: true,
          intersectionRatio: 1,
          time: 0,
          intersectionRect: {} as DOMRectReadOnly,
          boundingClientRect: {} as DOMRectReadOnly,
          rootBounds: null,
        },
      ]);
    });

    const linkTwo = screen.getByRole('link', { name: 'Two' });
    expect(linkTwo.getAttribute('aria-current')).toBe('location');
    // The other link is NOT marked current.
    expect(screen.getByRole('link', { name: 'One' }).getAttribute('aria-current')).toBeNull();
  });

  it('updates headings when window dispatches cairn:editor:doc-changed', () => {
    render(<TocSidebar initialDoc={doc([h(1, 'First')])} />);
    expect(screen.queryByRole('link', { name: 'Second' })).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('cairn:editor:doc-changed', {
          detail: { doc: doc([h(1, 'First'), h(2, 'Second')]) },
        }),
      );
    });
    expect(screen.getByRole('link', { name: 'Second' })).toBeTruthy();
  });
});
