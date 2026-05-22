'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

export type PageItem = { id: string; title: string; icon: string | null };

export type PageLinkListRef = { onKeyDown: (event: KeyboardEvent) => boolean };

export const PageLinkList = forwardRef<
  PageLinkListRef,
  { items: PageItem[]; command: (item: PageItem) => void }
>(function PageLinkList({ items, command }, ref) {
  const [index, setIndex] = useState(0);

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
        No pages
      </div>
    );
  }

  return (
    <div className="w-64 rounded-md border bg-popover shadow-md">
      <ul className="py-1">
        {items.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => command(item)}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === index ? 'bg-accent' : ''
              }`}
            >
              <span className="mr-1.5">{item.icon ?? '\u{1F4C4}'}</span>
              <span className="font-medium">{item.title || 'Untitled'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
