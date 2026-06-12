// @vitest-environment jsdom
//
// D3 / #188 — under lock the suggest-edits toggle stays mounted but disabled
// (not removed). The full <Editor> shell mounts TipTap + Yjs collab in jsdom,
// which is heavy and tickles a known Radix focus-scope teardown flake; this
// exercises the leaf control directly (the same component editor.tsx mounts)
// plus the gating booleans, which is where the lock logic lives.
//
// v0.10.2 P1 — the bibliography toggle moved to the "…" page menu; its lock
// contract is now "the menu item stays enabled, the editor-side event no-ops
// while locked", exercised here via useBibliographyVisibility.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuggestionToolbar } from '@/components/editor/suggestion-toolbar';
import { useBibliographyVisibility } from '@/components/editor/use-bibliography-visibility';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

const noop = () => {};

function toolbar(disabled: boolean) {
  return (
    <SuggestionToolbar
      editor={null}
      active={false}
      onToggle={noop}
      openCount={0}
      onMarkInsert={noop}
      onMarkDelete={noop}
      resolvable={null}
      onAccept={noop}
      onReject={noop}
      onOpenDrawer={noop}
      disabled={disabled}
    />
  );
}

describe('lock-mode editor controls (#188)', () => {
  it('keeps the Suggest edits toggle present but disabled when locked', () => {
    render(wrap(toolbar(true)));
    const btn = screen.getByRole('button', { name: /suggest/i });
    expect(btn).not.toBeNull();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe(enMessages['editor.suggest.lockedHint']);
  });

  it('keeps the Suggest edits toggle enabled when not locked', () => {
    render(wrap(toolbar(false)));
    const btn = screen.getByRole('button', { name: /suggest/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  // v0.10.0 E6 extended the #188 contract to the bibliography toggle;
  // v0.10.2 P1 re-expresses it event-side: the page-menu item stays enabled,
  // and the editor ignores its `cairn:bibliography:toggle` event while locked.
  it('bibliography toggles via the page-menu event when not locked', () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { result } = renderHook(() =>
      useBibliographyVisibility({ pageId: 'p1', initialDisabled: false, canToggle: true }),
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('cairn:bibliography:toggle'));
    });
    expect(result.current).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('ignores the bibliography toggle event while locked', () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { result } = renderHook(() =>
      useBibliographyVisibility({ pageId: 'p1', initialDisabled: false, canToggle: false }),
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('cairn:bibliography:toggle'));
    });
    expect(result.current).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
