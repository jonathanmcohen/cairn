// @vitest-environment jsdom
/**
 * Plan D1/D2 (#118/#119) — suggest-edits drawer regression guard (workflow-scoped).
 *
 * Both items shipped in v0.9.13; this file locks the contract at the workflow
 * boundary so a refactor cannot silently strip the inline <del>/<ins> diff
 * markup (D1) or break the card-click → onView wiring without firing
 * accept/reject (D2). The unit-level render harness (I18nProvider + en messages)
 * is shared with tests/components/editor/suggestions-drawer.test.tsx; here we
 * frame the same boundary as the suggest-edits workflow guard rather than
 * duplicating its exact cases verbatim.
 *
 * GAP (documented honestly): the editor.tsx viewSuggestion() side effects —
 * scrollIntoView({behavior:'smooth',block:'center'}) + posAtDOM +
 * chain().focus().setTextSelection() + setDrawerOpen(false) — depend on a live
 * TipTap EditorView and real DOM layout, which jsdom does not provide. That
 * scroll+select behaviour is covered at the integration/e2e level, NOT in this
 * jsdom unit. What we assert here is the drawer-boundary contract: the card
 * content region is a button whose click invokes onView(id) and does not
 * trigger the sibling accept/reject handlers.
 *
 * See docs/superpowers/plans/v0.9.14/plan-D-suggest-edits-drawer.md.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OpenSuggestion, SuggestionsDrawer } from '@/components/editor/suggestions-drawer';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

afterEach(cleanup);

function wrap(ui: ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

/** Render the drawer wrapped in the en I18nProvider; pass handler overrides. */
function renderDrawer(props: {
  suggestions: OpenSuggestion[];
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onView?: (id: string) => void;
}) {
  render(
    wrap(
      <SuggestionsDrawer
        open
        onOpenChange={() => {}}
        suggestions={props.suggestions}
        onAccept={props.onAccept ?? (() => {})}
        onReject={props.onReject ?? (() => {})}
        onView={props.onView ?? (() => {})}
      />,
    ),
  );
}

describe('D1 #118 — inline diff renders <del> + <ins> in suggestion cards', () => {
  it('card renders <del> for deleted text and <ins> for inserted text', () => {
    renderDrawer({
      suggestions: [
        {
          id: 's1',
          authorName: 'Alice',
          diff: { deleted: 'original phrase', inserted: 'revised phrase' },
        },
      ],
    });
    expect(screen.getByText('original phrase').tagName).toBe('DEL');
    expect(screen.getByText('revised phrase').tagName).toBe('INS');
  });

  it('card renders only <ins> for an insert-only suggestion', () => {
    renderDrawer({
      suggestions: [
        { id: 's1', authorName: 'Alice', diff: { deleted: '', inserted: 'added text' } },
      ],
    });
    expect(screen.getByText('added text').tagName).toBe('INS');
    // No deleted half → no <del> element anywhere in the card.
    expect(document.querySelector('del')).toBeNull();
  });

  it('card renders only <del> for a delete-only suggestion', () => {
    renderDrawer({
      suggestions: [
        { id: 's1', authorName: 'Alice', diff: { deleted: 'removed text', inserted: '' } },
      ],
    });
    expect(screen.getByText('removed text').tagName).toBe('DEL');
    // No inserted half → no <ins> element anywhere in the card.
    expect(document.querySelector('ins')).toBeNull();
  });

  it('card omits the diff block entirely when diff is absent', () => {
    renderDrawer({ suggestions: [{ id: 's1', authorName: 'Alice' }] });
    // The sr-only diff labels only render when a diff half is present.
    expect(screen.queryByText(enMessages['pageActions.suggest.diffDeletedLabel'])).toBeNull();
    expect(screen.queryByText(enMessages['pageActions.suggest.diffInsertedLabel'])).toBeNull();
    expect(document.querySelector('del')).toBeNull();
    expect(document.querySelector('ins')).toBeNull();
  });
});

describe('D2 #119 — card click fires onView and NOT onAccept/onReject', () => {
  it('clicking the card content region fires onView with the correct suggestion id', () => {
    const onView = vi.fn();
    renderDrawer({
      suggestions: [
        { id: 's1', authorName: 'Alice' },
        { id: 's2', authorName: 'Bob' },
      ],
      onView,
    });
    // The content region is the <button> labelled by the author line ("by Alice").
    fireEvent.click(screen.getByRole('button', { name: /by Alice/ }));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith('s1');
    expect(onView).not.toHaveBeenCalledWith('s2');
  });

  it('clicking Accept fires onAccept but NOT onView (sibling button)', () => {
    const onView = vi.fn();
    const onAccept = vi.fn();
    renderDrawer({ suggestions: [{ id: 's1', authorName: 'Alice' }], onAccept, onView });
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.suggest.accept'] }));
    expect(onAccept).toHaveBeenCalledWith('s1');
    expect(onView).not.toHaveBeenCalled();
  });

  it('clicking Reject fires onReject but NOT onView (sibling button)', () => {
    const onView = vi.fn();
    const onReject = vi.fn();
    renderDrawer({ suggestions: [{ id: 's1', authorName: 'Alice' }], onReject, onView });
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.suggest.reject'] }));
    expect(onReject).toHaveBeenCalledWith('s1');
    expect(onView).not.toHaveBeenCalled();
  });

  it('clicking the explicit "View in document" button also fires onView', () => {
    const onView = vi.fn();
    renderDrawer({ suggestions: [{ id: 's1', authorName: 'Alice' }], onView });
    fireEvent.click(
      screen.getByRole('button', { name: enMessages['pageActions.suggest.viewInDoc'] }),
    );
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith('s1');
  });
});
