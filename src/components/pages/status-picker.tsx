'use client';

/**
 * G16 #163 — page lifecycle status badge + transition menu.
 *
 * Renders the current status as a badge. For editors, the badge is a popover
 * trigger that lists the allowed next statuses (computed locally via the same
 * `canTransition` matrix the server enforces) and POSTs the chosen target to
 * the status route, refreshing the route on success. There is no shadcn
 * DropdownMenu primitive in this repo, so this is built on the themed Popover
 * with explicit menu/menuitem roles for keyboard + a11y semantics.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PAGE_STATUSES, type PageStatus } from '@/db/schema';
import { useT } from '@/lib/i18n/provider';
import { canTransition } from '@/lib/pages/status-rules';

const STATUS_KEY: Record<PageStatus, string> = {
  draft: 'pages.status.draft',
  review: 'pages.status.review',
  published: 'pages.status.published',
  archived: 'pages.status.archived',
};

export function StatusPicker({
  pageId,
  initialStatus,
  canEdit,
}: {
  pageId: string;
  initialStatus: PageStatus;
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const [status, setStatus] = useState<PageStatus>(initialStatus);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
        data-status={status}
      >
        {t(STATUS_KEY[status])}
      </span>
    );
  }

  const targets = PAGE_STATUSES.filter((s) => canTransition(status, s));

  async function change(to: PageStatus): Promise<void> {
    // v0.10.0 D5 — archiving a published page silently kills its public
    // `/p/<slug>` render (public.ts gates on status='published') and drops it
    // from the `/s/<slug>` site index, so surface that side effect before
    // committing instead of letting the link die quietly.
    if (to === 'archived' && status === 'published') {
      const ok = await confirm({
        title: t('pages.status.archiveConfirmTitle'),
        description: t('pages.status.archiveConfirmPublished'),
        confirmLabel: t('pages.status.archiveConfirmAction'),
      });
      if (!ok) {
        setOpen(false);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        setError(t('pages.status.changeError'));
        return;
      }
      const data = (await res.json()) as { status: PageStatus };
      setStatus(data.status);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          aria-label={t('pages.status.change')}
          disabled={busy}
          data-status={status}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium hover:bg-accent/40 disabled:opacity-50"
        >
          {t(STATUS_KEY[status])}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          <div role="menu" className="flex flex-col">
            {targets.map((to) => (
              <button
                key={to}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void change(to)}
                className="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                {t(STATUS_KEY[to])}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
