'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export type MentionItem = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

// Kept in sync with presence-avatars.tsx#initials — a 6-line pure helper; not
// abstracted into a shared module on purpose (avoids an import dependency from
// the detached ReactRenderer mount).
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

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
  {
    items: MentionItem[];
    command: (item: MentionItem) => void;
    /**
     * v0.9.4 P26 #108 — trigger-clarity footer ("@ for people · [[ for pages").
     * Passed in (already translated) by the suggestion extension because this
     * component mounts via ReactRenderer detached from the <I18nProvider> tree,
     * so `useT()` can't resolve here. Optional so existing call sites/tests work.
     */
    hint?: string;
  }
>(function MentionList({ items, command, hint }, ref) {
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
        <div className="p-2 text-sm text-muted-foreground">No members</div>
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
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === index ? 'bg-accent' : ''
              }`}
            >
              {/* Decorative: the row already announces name + email, so the
                  avatar is aria-hidden / alt="" to avoid a double announcement. */}
              <Avatar size="sm" aria-hidden>
                {item.image ? <AvatarImage src={item.image} alt="" /> : null}
                <AvatarFallback>{initials(item.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.email}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
});
