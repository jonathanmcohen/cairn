// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

// The row navigates via <Link href="/pages/[id]">. next/link renders a real
// <a> in jsdom, so we assert on the anchor's href + accessible affordance
// rather than mocking router.push — Link navigation is anchor-driven, not a
// push() call. The "… does NOT navigate" guarantee is structural: the action
// trigger is a sibling that stopPropagations, never the navigating anchor.
const LABELS: Record<string, string> = {
  'pageRow.open': 'Open Doc',
  'pageRow.rename': 'Rename',
  'pageRow.addChild': 'Add subpage',
  'pageRow.actions': 'Page actions',
  'pageMenu.moveToTrash': 'Move to trash',
  'pageMenu.duplicate': 'Duplicate page',
  'pageMenu.copyLink': 'Copy link',
  'pageMenu.moveTo': 'Move to…',
};
vi.mock('@/lib/i18n/provider', () => ({
  useT: () => (k: string) => LABELS[k] ?? k,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

// @tanstack/react-virtual reads offsetHeight/offsetWidth to size the window and
// needs a ResizeObserver; jsdom ships neither. Mirror the polyfills used in
// tests/components/sidebar/virtualized-page-tree.test.tsx so the row renders.
beforeAll(() => {
  const H = 600;
  const W = 240;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-y-auto') ? H : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-y-auto') ? W : 0;
    },
  });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
});

afterEach(cleanup);

const PAGE_ID = '11111111-1111-1111-1111-111111111111';
const nodes: FlatPageNode[] = [
  { id: PAGE_ID, parentId: null, title: 'Doc', icon: null, depth: 0, childCount: 0 },
];

describe('PageTreeRow navigation', () => {
  it('the row exposes a single navigating link to /pages/[id] covering the whole row', () => {
    render(<VirtualizedPageTree initial={nodes} />);
    // Exactly one navigating anchor per row, pointed at the page.
    const link = screen.getByRole('link', { name: /open doc/i });
    expect(link.getAttribute('href')).toBe(`/pages/${PAGE_ID}`);
    // It is the full-row hit target: an absolutely-positioned inset overlay,
    // not a flex-1 strip that leaves dead zones.
    expect(link.className).toMatch(/absolute/);
    expect(link.className).toMatch(/inset-0/);
  });

  it('the navigating link is keyboard-focusable (Enter/Space activate an <a>)', () => {
    render(<VirtualizedPageTree initial={nodes} />);
    const link = screen.getByRole('link', { name: /open doc/i });
    // A real <a href> is in the tab order and Enter/Space activate it natively;
    // assert it is a genuine anchor with href (not a div with onClick).
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('aria-disabled')).toBe(false);
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('the "…" actions trigger is a separate button that does NOT navigate', () => {
    render(<VirtualizedPageTree initial={nodes} />);
    const more = screen.getByRole('button', { name: /page actions/i });
    // The trigger is a <button>, never the navigating anchor.
    expect(more.tagName).toBe('BUTTON');
    const link = screen.getByRole('link', { name: /open doc/i });
    expect(more).not.toBe(link);
    // Clicking it must not bubble into row navigation: a click on the trigger
    // does not change location (jsdom keeps location at the test origin).
    const before = window.location.href;
    fireEvent.click(more);
    expect(window.location.href).toBe(before);
  });

  it('the action cluster sits above the link overlay (z-10) so its buttons stay clickable', () => {
    const { container } = render(<VirtualizedPageTree initial={nodes} />);
    // The cluster wrapper is a positioned sibling stacked above the inset link.
    const cluster = container.querySelector('[data-row-actions]');
    expect(cluster).not.toBeNull();
    expect((cluster as HTMLElement).className).toMatch(/relative/);
    expect((cluster as HTMLElement).className).toMatch(/z-10/);
  });
});
