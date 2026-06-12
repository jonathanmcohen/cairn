// @vitest-environment jsdom
//
// v0.10.2 P1 — the bibliography toggle moved from the editor toolbar into the
// "…" page menu, which dispatches a `cairn:bibliography:toggle` CustomEvent
// (mirroring `cairn:export:open`). This re-routes the old BibliographyToggle
// component coverage onto the editor-side hook that receives the event: flip +
// metadata PATCH, rollback on a rejected save, and the D3/#188 lock contract
// (the event no-ops while the page is locked / the viewer can't edit).
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBibliographyVisibility } from '@/components/editor/use-bibliography-visibility';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dispatchToggle() {
  act(() => {
    window.dispatchEvent(new CustomEvent('cairn:bibliography:toggle'));
  });
}

describe('useBibliographyVisibility', () => {
  it('flips on the page-menu event and PATCHes disable_bibliography=true', async () => {
    const { result } = renderHook(() =>
      useBibliographyVisibility({ pageId: 'page-1', initialDisabled: false, canToggle: true }),
    );
    expect(result.current).toBe(false);
    dispatchToggle();
    expect(result.current).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/pages/page-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      metadata: { disable_bibliography: true },
    });
  });

  it('toggles back on a second event (round trip)', async () => {
    const { result } = renderHook(() =>
      useBibliographyVisibility({ pageId: 'page-1', initialDisabled: false, canToggle: true }),
    );
    dispatchToggle();
    dispatchToggle();
    expect(result.current).toBe(false);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      metadata: { disable_bibliography: false },
    });
  });

  it('rolls back the optimistic flip on a rejected save', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    const { result } = renderHook(() =>
      useBibliographyVisibility({ pageId: 'page-1', initialDisabled: false, canToggle: true }),
    );
    dispatchToggle();
    expect(result.current).toBe(true);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('no-ops while canToggle is false (the D3/#188 lock contract)', () => {
    const { result } = renderHook(() =>
      useBibliographyVisibility({ pageId: 'page-1', initialDisabled: false, canToggle: false }),
    );
    dispatchToggle();
    expect(result.current).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
