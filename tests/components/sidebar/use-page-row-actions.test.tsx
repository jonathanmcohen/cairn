// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageRowActions } from '@/components/sidebar/use-page-row-actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// i18n provider: stub useT to echo the key so labels are assertable without a provider.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

const node = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Doc',
  spaceId: null,
  depth: 0,
  icon: null,
} as unknown as import('@/lib/pages/tree').FlatPageNode;

describe('usePageRowActions', () => {
  it('exposes the canonical action set in order', () => {
    const { result } = renderHook(() => usePageRowActions(node));
    const ids = result.current.actions.map((a) => a.id);
    expect(ids).toEqual(['rename', 'addChild', 'duplicate', 'copyLink', 'moveTo', 'trash']);
    for (const a of result.current.actions) {
      expect(typeof a.label).toBe('string');
      expect(a.icon).toBeTruthy();
      expect(typeof a.run).toBe('function');
    }
  });

  it('copyLink writes the internal page URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => usePageRowActions(node));
    const copy = result.current.actions.find((a) => a.id === 'copyLink');
    await act(async () => {
      await copy?.run();
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/pages/${node.id}`));
  });
});
