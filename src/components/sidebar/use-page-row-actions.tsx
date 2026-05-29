'use client';

import type { LucideIcon } from 'lucide-react';
import { Copy, CopyPlus, FilePlus2, FolderInput, Pencil, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';

export type PageRowAction = {
  id: 'rename' | 'addChild' | 'duplicate' | 'copyLink' | 'moveTo' | 'trash';
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  run: () => void | Promise<void>;
};

export type PageRowActionsApi = {
  actions: PageRowAction[];
  linkCopied: boolean;
  /** Begin inline rename (the consuming row swaps its title span for an input). */
  startRename: () => void;
  renaming: boolean;
  submitRename: (next: string) => Promise<void>;
  cancelRename: () => void;
};

/**
 * Single source of truth for the sidebar page-row action set. Consumed by both
 * the hover `…` DropdownMenu (Task 2) and the right-click ContextMenu (Task 3)
 * so the two surfaces can never drift. Reuses the same backend wiring the page
 * `…` menu uses (P19): Trash (`DELETE /api/pages/[id]`), Duplicate
 * (`POST .../duplicate`), Copy-link (client-only). Add-child reuses
 * `POST /api/pages` and Rename reuses `PATCH /api/pages/[id]`.
 */
export function usePageRowActions(node: FlatPageNode): PageRowActionsApi {
  const t = useT();
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/pages/${node.id}`;
    void navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }, [node.id]);

  const addChild = useCallback(async () => {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: node.id, spaceId: node.spaceId ?? undefined }),
    });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    router.push(`/pages/${id}` as Route);
  }, [node.id, node.spaceId, router]);

  const duplicate = useCallback(async () => {
    // Reuses the endpoint introduced by P19 (duplicateOwnedPage).
    const res = await fetch(`/api/pages/${node.id}/duplicate`, { method: 'POST' });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    router.push(`/pages/${id}` as Route);
  }, [node.id, router]);

  const moveToTrash = useCallback(async () => {
    if (!window.confirm(t('pageMenu.confirmTrash'))) return;
    const res = await fetch(`/api/pages/${node.id}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
  }, [node.id, router, t]);

  const submitRename = useCallback(
    async (next: string) => {
      const title = next.trim();
      setRenaming(false);
      if (!title || title === node.title) return;
      const res = await fetch(`/api/pages/${node.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) router.refresh();
    },
    [node.id, node.title, router],
  );

  const actions: PageRowAction[] = [
    { id: 'rename', label: t('pageRow.rename'), icon: Pencil, run: () => setRenaming(true) },
    { id: 'addChild', label: t('pageRow.addChild'), icon: FilePlus2, run: addChild },
    { id: 'duplicate', label: t('pageMenu.duplicate'), icon: CopyPlus, run: duplicate },
    {
      id: 'copyLink',
      label: linkCopied ? t('pageMenu.linkCopied') : t('pageMenu.copyLink'),
      icon: Copy,
      run: copyLink,
    },
    {
      id: 'moveTo',
      label: t('pageMenu.moveTo'),
      icon: FolderInput,
      // TODO(move-to): the reparent picker UX is shared with P19's deferred
      // `#76 Move-to picker` follow-up (POST /api/pages/[id]/move { newParentId },
      // newParentId:null = top level). The endpoint exists; only the picker
      // popover is unbuilt. Ships as a follow-up shared with #76 — do NOT build
      // a second bespoke picker here. Run is a no-op until the picker lands.
      run: () => {},
    },
    {
      id: 'trash',
      label: t('pageMenu.moveToTrash'),
      icon: Trash2,
      destructive: true,
      run: moveToTrash,
    },
  ];

  return {
    actions,
    linkCopied,
    startRename: () => setRenaming(true),
    renaming,
    submitRename,
    cancelRename: () => setRenaming(false),
  };
}
