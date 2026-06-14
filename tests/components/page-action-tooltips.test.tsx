// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PageActionPanels } from '@/components/pages/page-action-panels';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

beforeAll(() => {
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

// v0.10.2 P1 — the Lock trigger left this cluster for the "…" page menu; its
// accessible-name coverage now lives in tests/components/page-menu-lock.test.tsx.
describe('PageActionPanels tooltips', () => {
  it('shows a hover tooltip when the comments trigger is focused', async () => {
    render(
      <PageActionPanels
        pageId="p1"
        canComment
        currentUserId="u1"
        currentRole="editor"
        canEditVersions
      />,
    );
    const commentsBtn = screen.getByLabelText('Comments');
    fireEvent.focus(commentsBtn);
    expect(await screen.findAllByText('Comments')).not.toHaveLength(0);
  });
});
