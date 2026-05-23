'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useState } from 'react';

export type MentionItem = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type MentionListRef = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

/**
 * `@`-mention popup. Exposed as a `listbox`; DOM focus stays in the editor so
 * typing keeps working. The popup is driven by `aria-activedescendant`
 * pointing at the highlighted option's id — SR users perceive the active item
 * while ArrowUp/Down/Enter are handled by TipTap's keymap (forwarded here).
 */
export const MentionList = forwardRef<
  MentionListRef,
  { items: MentionItem[]; command: (item: MentionItem) => void }
>(function MentionList({ items, command }, ref) {
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

  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No members
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
        aria-label="Members"
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
              <div className="font-medium">{item.name}</div>
              <div className="text-xs text-muted-foreground">{item.email}</div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
