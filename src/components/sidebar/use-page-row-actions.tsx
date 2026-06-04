'use client';

import type { LucideIcon } from 'lucide-react';
import { Copy, CopyPlus, FilePlus2, FolderInput, Pencil, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { resetPageFocusMode } from '@/components/pages/page-mode-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
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
  /** True while an async row action (add-child / duplicate / trash) is in flight. */
  busy: boolean;
  /** Begin inline rename (the consuming row swaps its title span for an input). */
  startRename: () => void;
  renaming: boolean;
  submitRename: (next: string) => Promise<void>;
  cancelRename: () => void;
  /** v0.9.6 #124 — Move-To picker open-state, owned here so the hover `…` menu
   *  and the right-click context menu share one dialog instance. */
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
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
  const confirm = useConfirm();
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/pages/${node.id}`;
    void navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }, [node.id]);

  const addChild = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentId: node.id, spaceId: node.spaceId ?? undefined }),
      });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id: string };
      // A freshly created child page must open with chrome visible (#247).
      resetPageFocusMode();
      router.push(`/pages/${id}` as Route);
      // G10 finding S — the sidebar tree is server-rendered initial props; navigating
      // alone leaves the still-mounted tree stale. Refresh re-runs the server component
      // (re-fetches flattenedPageTree) so the new child appears without F5. Mirrors
      // new-page-button.tsx's push-then-refresh.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [node.id, node.spaceId, router]);

  const duplicate = useCallback(async () => {
    setBusy(true);
    try {
      // Reuses the endpoint introduced by P19 (duplicateOwnedPage).
      const res = await fetch(`/api/pages/${node.id}/duplicate`, { method: 'POST' });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id: string };
      router.push(`/pages/${id}` as Route);
      // G10 finding S — refresh the server-rendered tree so the duplicate appears now.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [node.id, router]);

  const moveToTrash = useCallback(async () => {
    const ok = await confirm({
      title: t('pageMenu.confirmTrash'),
      confirmLabel: t('pageMenu.moveToTrash'),
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pages/${node.id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }, [node.id, router, t, confirm]);

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
      // v0.9.6 #124 — opens the shared Move-To picker (POST .../move
      // { newParentId }, null = top level). The dialog is mounted by the
      // consuming surface (row menu / context menu) and driven by `moveOpen`.
      run: () => setMoveOpen(true),
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
    busy,
    startRename: () => setRenaming(true),
    renaming,
    submitRename,
    cancelRename: () => setRenaming(false),
    moveOpen,
    setMoveOpen,
  };
}
