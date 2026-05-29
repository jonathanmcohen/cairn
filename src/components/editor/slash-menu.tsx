'use client';

import type { Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useId, useImperativeHandle, useState } from 'react';

export type SlashCategory = 'basic' | 'media' | 'database' | 'advanced';

export type SlashItem = {
  title: string;
  description: string;
  category: SlashCategory;
  command: (editor: Editor) => void;
  icon?: LucideIcon;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when filtered items change
  useEffect(() => {
    setIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
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
        No results
      </div>
    );
  }

  const activeId = `${listId}-${index}`;
  return (
    <div className="w-64 rounded-md border bg-popover shadow-md">
      {/*
        ARIA listbox built from div + role rather than ul/li: Biome's a11y rules
        forbid putting `role="listbox"`/`role="option"` on `<ul>`/`<li>`, and
        the listbox needs `tabIndex={0}` so `aria-activedescendant` is reachable
        even though we never DOM-focus it (TipTap's keymap forwards keys here
        while focus stays in the editor surface).
      */}
      <div
        role="listbox"
        aria-label="Slash commands"
        aria-activedescendant={activeId}
        tabIndex={0}
        className="py-1"
      >
        {items.map((item, i) => (
          <div
            key={item.title}
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
              {item.icon ? (
                <item.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="block font-medium">{item.title}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
