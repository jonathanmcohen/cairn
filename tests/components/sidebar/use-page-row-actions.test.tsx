// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageRowActions } from '@/components/sidebar/use-page-row-actions';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
// i18n provider: stub useT to echo the key so labels are assertable without a provider.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);
beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

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

describe('usePageRowActions — moveTo picker wiring', () => {
  it('moveTo.run opens the picker (moveOpen flips true)', () => {
    const { result } = renderHook(() => usePageRowActions(node));
    expect(result.current.moveOpen).toBe(false);
    const moveTo = result.current.actions.find((a) => a.id === 'moveTo');
    act(() => {
      void moveTo?.run();
    });
    expect(result.current.moveOpen).toBe(true);
  });

  it('setMoveOpen(false) closes the picker', () => {
    const { result } = renderHook(() => usePageRowActions(node));
    act(() => {
      void result.current.actions.find((a) => a.id === 'moveTo')?.run();
    });
    act(() => result.current.setMoveOpen(false));
    expect(result.current.moveOpen).toBe(false);
  });
});

describe('usePageRowActions — post-mutation tree refresh', () => {
  function mockFetchOk(body: unknown) {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  }

  it('addChild navigates to the new page AND refreshes the server tree', async () => {
    const fetchSpy = mockFetchOk({ id: 'child-22222222' });
    const { result } = renderHook(() => usePageRowActions(node));
    await act(async () => {
      await result.current.actions.find((a) => a.id === 'addChild')?.run();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/pages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(push).toHaveBeenCalledWith('/pages/child-22222222');
    expect(refresh).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('duplicate navigates to the copy AND refreshes the server tree', async () => {
    const fetchSpy = mockFetchOk({ id: 'copy-33333333' });
    const { result } = renderHook(() => usePageRowActions(node));
    await act(async () => {
      await result.current.actions.find((a) => a.id === 'duplicate')?.run();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/pages/${node.id}/duplicate`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(push).toHaveBeenCalledWith('/pages/copy-33333333');
    expect(refresh).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('addChild does NOT refresh when the create fails', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 500 }));
    const { result } = renderHook(() => usePageRowActions(node));
    await act(async () => {
      await result.current.actions.find((a) => a.id === 'addChild')?.run();
    });
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
