'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LongPress } from '@/components/mobile/long-press';
import type { PageTreeNode } from '@/lib/pages/tree';

/**
 * Sidebar tree row. Wraps the existing `<Link>` in a `<LongPress>` so mobile
 * users get a context menu after a 500ms hold (Rename / Delete / Favorite);
 * desktop click + keyboard handlers on the link are untouched.
 */
export function SidebarTreeItem({ node, depth }: { node: PageTreeNode; depth: number }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function onRename() {
    const next = window.prompt('Rename page', node.title)?.trim();
    setMenuOpen(false);
    if (!next || next === node.title) return;
    await fetch(`/api/pages/${node.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    router.refresh();
  }

  async function onDelete() {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${node.title}"?`)) return;
    await fetch(`/api/pages/${node.id}`, { method: 'DELETE' });
    router.refresh();
  }

  async function onFavorite() {
    setMenuOpen(false);
    await fetch('/api/prefs/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: node.id }),
    });
    router.refresh();
  }

  return (
    <li className="relative">
      <LongPress onLongPress={() => setMenuOpen(true)}>
        <Link
          href={`/pages/${node.id}` as Route}
          className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="w-4 shrink-0 text-center">{node.icon ?? '📄'}</span>
          <span className="truncate">{node.title}</span>
        </Link>
      </LongPress>
      {menuOpen ? (
        <div
          role="dialog"
          aria-label={`Actions for ${node.title}`}
          className="absolute right-0 top-full z-20 mt-0.5 w-44 rounded-md border bg-popover py-1 shadow-md"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => void onRename()}
          >
            Rename
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => void onFavorite()}
          >
            Favorite
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
            onClick={() => void onDelete()}
          >
            Delete
          </button>
        </div>
      ) : null}
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <SidebarTreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
