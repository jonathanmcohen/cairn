'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useState } from 'react';

export type PageItem = { id: string; title: string; icon: string | null };

export type PageLinkListRef = { onKeyDown: (event: KeyboardEvent) => boolean };

/**
 * `[[`/`@@` page-link autocomplete popup. Exposed as a `listbox`; DOM focus
 * stays in the editor so typing keeps working. The popup is driven by
 * `aria-activedescendant` pointing at the highlighted option's id — SR users
 * perceive the active item while ArrowUp/Down/Enter are handled by TipTap's
 * keymap (forwarded here through the parent suggestion plugin).
 */
export const PageLinkList = forwardRef<
  PageLinkListRef,
  {
    items: PageItem[];
    command: (item: PageItem) => void;
    /**
     * v0.9.4 P26 #108 — trigger-clarity footer ("[[ or @@ for pages · @ for
     * people"). Passed in (already translated) by the page-link suggestion
     * extension because this component mounts via ReactRenderer detached from
     * the <I18nProvider> tree, so `useT()` can't resolve here. Optional so
     * existing call sites/tests work.
     */
    hint?: string;
  }
>(function PageLinkList({ items, command, hint }, ref) {
  const [index, setIndex] = useState(0);
  const listId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when filtered items change
  useEffect(() => {
    setIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        const chosen = items[index];
        if (chosen) command(chosen);
        return true;
      }
      return false;
    },
  }));

  // v0.9.4 P26 #108 — footer hint is aria-hidden so it doesn't pollute the
  // aria-activedescendant option set; it is a purely visual affordance.
  const footer = hint ? (
    <div className="border-t px-3 py-1.5 text-xs text-muted-foreground" aria-hidden>
      {hint}
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-md border bg-popover shadow-md">
        <div className="p-2 text-sm text-muted-foreground">No pages</div>
        {footer}
      </div>
    );
  }

  const activeId = `${listId}-${index}`;
  return (
    <div className="w-64 rounded-md border bg-popover shadow-md">
      {/*
        See slash-menu.tsx for the rationale on div+role over ul/li and on the
        listbox being tabbable but not actually DOM-focused.
      */}
      <div
        role="listbox"
        aria-label="Pages"
        aria-activedescendant={activeId}
        tabIndex={0}
        className="py-1"
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            role="option"
            id={`${listId}-${i}`}
            aria-selected={i === index}
            tabIndex={-1}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => command(item)}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === index ? 'bg-accent' : ''
              }`}
            >
              <span className="mr-1.5">{item.icon ?? '\u{1F4C4}'}</span>
              <span className="font-medium">{item.title || 'Untitled'}</span>
            </button>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
});
