'use client';

import type { Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

export type SlashCategory = 'basic' | 'media' | 'database' | 'advanced';

/** A trigger range `{from, to}` spanning the `/query` text (incl. the `/`). */
export type SlashRange = { from: number; to: number };

export type SlashItem = {
  title: string;
  description: string;
  category: SlashCategory;
  /**
   * #38 — invoked with the editor and the corrected trigger range. Synchronous
   * (immediate-insert) items ignore `range`: the dispatcher (`runSlashItem`)
   * deletes the `/query` trigger for them before invoking. DEFERRED items
   * (those marked `deferred: true` — dialogs, file pickers, lazy/async inserts
   * that the user can cancel) receive the range and MUST delete it themselves
   * only once they actually commit an insert, leaving the text intact on
   * cancel/early-return (restore-on-cancel).
   */
  command: (editor: Editor, range?: SlashRange) => void;
  icon?: LucideIcon;
  /**
   * #76/#77/#111/#112 — true when `command` may defer or cancel (dialog/picker/
   * lazy load/async fetch). The dispatcher then does NOT pre-delete the trigger
   * range; the command deletes it itself on a successful insert. Default falsy
   * = synchronous immediate insert.
   */
  deferred?: boolean;
  /**
   * #148 — synonym aliases. The slash search matches the query against the
   * title OR any keyword (case-insensitive substring), so `/math` finds
   * "Equation", `/youtube` finds "Embed", etc. Always present (default `[]`)
   * so consumers never branch on `undefined`.
   */
  keywords: string[];
};

export type SlashMenuRef = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

/** Fixed display order for grouped slash-menu sections (#122). */
export const SLASH_CATEGORY_ORDER: SlashCategory[] = ['basic', 'media', 'database', 'advanced'];

export type SlashGroup = { category: SlashCategory; items: SlashItem[] };

/**
 * Group items by category in a fixed display order, dropping empty groups.
 * The flattened group order MUST equal the input filter order's category
 * partition so keyboard nav (which indexes the flat list) stays coherent.
 */
export function groupSlashItems(items: SlashItem[]): SlashGroup[] {
  return SLASH_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
}

/**
 * Category header labels. The SlashMenu is mounted via TipTap's `ReactRenderer`,
 * which portals the tree to `document.body` — OUTSIDE the `<I18nProvider>` — so
 * `useT()` would throw here. We therefore use a static label map keyed by
 * category (option (b) in the plan). The matching `slash.group.*` keys live in
 * `messages/{en,es,ar}.json` for any provider-scoped consumer/future move.
 */
const CATEGORY_LABEL: Record<SlashCategory, string> = {
  basic: 'Basic',
  media: 'Media',
  database: 'Database',
  advanced: 'Advanced',
};

/**
 * Bespoke ProseMirror-anchored popup for `/` slash commands. ARIA-wise we
 * expose this as a `listbox` so screen readers announce the selectable items
 * — but DOM focus stays in the editor (TipTap's keymap forwards ArrowUp/Down/
 * Enter/Esc here via the parent extension's `onKeyDown`). The container
 * carries `aria-activedescendant` pointing at the currently-highlighted
 * option's id so SR users perceive the active item while typing.
 */
export const SlashMenu = forwardRef<
  SlashMenuRef,
  { items: SlashItem[]; command: (item: SlashItem) => void }
>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  const listId = useId();
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // #122 — single source of truth for the flat selectable order: the grouped
  // partition flattened. Both keyboard indexing (`ordered[index]`) AND the
  // grouped render derive from this, so the visual order and the index agree.
  const ordered = useMemo(() => groupSlashItems(items).flatMap((g) => g.items), [items]);
  const groups = useMemo(() => groupSlashItems(items), [items]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when filtered items change
  useEffect(() => {
    setIndex(0);
  }, [ordered]);

  // Keep the highlighted option in view as Arrow keys move across groups.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on index change to scroll the newly-active row into view (the ref read is itself stable)
  useEffect(() => {
    // Guard: jsdom (test env) doesn't implement scrollIntoView.
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (ordered.length === 0) return false;
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + ordered.length - 1) % ordered.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % ordered.length);
        return true;
      }
      if (event.key === 'Enter') {
        // #38 — stop the Enter from leaking to the editor keymap (which would
        // split the block / insert a newline alongside the slash command). The
        // suggestion render layer also returns `true`, but preventing default
        // here guarantees the keystroke is consumed even if the host forwards
        // the raw event.
        event.preventDefault();
        const chosen = ordered[index];
        if (chosen) command(chosen);
        return true;
      }
      return false;
    },
  }));

  if (ordered.length === 0) {
    return (
      <div className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No results
      </div>
    );
  }

  const activeId = `${listId}-${index}`;
  // Running flat index across groups so `aria-activedescendant`/highlight stay
  // correct across group boundaries (the flat order equals `ordered`).
  let flat = -1;
  return (
    <div className="w-64 rounded-md border bg-popover shadow-md">
      {/*
        ARIA listbox built from div + role rather than ul/li: Biome's a11y rules
        forbid putting `role="listbox"`/`role="option"` on `<ul>`/`<li>`, and
        the listbox needs `tabIndex={0}` so `aria-activedescendant` is reachable
        even though we never DOM-focus it (TipTap's keymap forwards keys here
        while focus stays in the editor surface). #122: the list is grouped into
        category sections with non-interactive (`role="presentation"`) headers,
        and bounded with `max-h-80 overflow-y-auto` so the full catalog scrolls.
      */}
      <div
        role="listbox"
        aria-label="Slash commands"
        aria-activedescendant={activeId}
        tabIndex={0}
        className="max-h-80 overflow-y-auto py-1"
      >
        {groups.map((group) => (
          // Layout-only wrapper. The category header below is decorative
          // (`role="presentation"`) so it stays out of the activedescendant
          // index; SR users perceive the active item through the listbox's
          // `aria-activedescendant` model regardless of grouping. (We avoid
          // `role="group"` here because Biome's useSemanticElements would push
          // it to <fieldset>, which is wrong inside a listbox.)
          <div key={group.category}>
            <div
              role="presentation"
              className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {CATEGORY_LABEL[group.category]}
            </div>
            {group.items.map((item) => {
              flat += 1;
              const i = flat;
              return (
                <div
                  key={item.title}
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={i === index}
                  tabIndex={-1}
                >
                  <button
                    ref={i === index ? activeRef : undefined}
                    type="button"
                    tabIndex={-1}
                    onClick={() => command(item)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${
                      i === index ? 'bg-accent' : ''
                    }`}
                  >
                    {item.icon ? (
                      <item.icon
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block font-medium">{item.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
