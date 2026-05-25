'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef } from 'react';
import { EmptyPageTree } from '@/components/empty-state/variants';
import type { FlatPageNode } from '@/lib/pages/tree';

const ROW_HEIGHT_PX = 32; // Matches the existing sidebar row.
const DEPTH_INDENT_PX = 16; // 16px per level; matches the v0.7 visual.
const OVERSCAN = 8; // Extra rows above/below the viewport for smooth scroll.

/**
 * Windowed render of the page-tree sidebar. The server pre-flattens the tree
 * via `flattenedPageTree(workspaceId)` so this component never recurses; the
 * virtualizer keys rendering by index, with `paddingLeft: depth * 16px` for
 * visual nesting. Sustains 10k+ pages without DOM jank (the recursive shape
 * grew O(n) DOM nodes; this stays O(viewport)).
 *
 * The scroll container is THIS component's own <ul> wrapped in a fixed-height
 * <div> (`h-full overflow-y-auto`). The parent sidebar <nav> owns layout
 * (flex-1 minus header/footer); this component fills its parent.
 */
export function VirtualizedPageTree({ initial }: { initial: FlatPageNode[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: initial.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN,
    getItemKey: (index) => initial[index]?.id ?? index,
    // Seed the viewport so the initial render window isn't empty before the
    // ResizeObserver fires (matters for SSR hydration and jsdom tests where
    // layout never measures). 600px ≈ one sidebar viewport on a laptop.
    initialRect: { width: 240, height: 600 },
  });

  if (initial.length === 0) {
    return (
      <div className="px-2 py-4">
        <EmptyPageTree />
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <ul
        className="relative w-full"
        // The virtualizer needs a tall spacer so the scrollbar reflects the
        // total list height even though only the windowed rows are mounted.
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtual) => {
          const node = initial[virtual.index];
          if (!node) return null;
          return (
            <li
              key={node.id}
              data-virtual-row=""
              data-depth={node.depth}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtual.size}px`,
                transform: `translateY(${virtual.start}px)`,
              }}
            >
              <Link
                href={`/pages/${node.id}` as Route}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                style={{ paddingLeft: `${node.depth * DEPTH_INDENT_PX + 8}px` }}
              >
                <span className="w-4 shrink-0 text-center">{node.icon ?? '📄'}</span>
                <span className="truncate">{node.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
