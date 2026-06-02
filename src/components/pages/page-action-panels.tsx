'use client';

import { FolderInput } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CommentsToggle } from '@/components/comments/comments-toggle';
import { PageExportMenu } from '@/components/pages/export-menu';
import { LockToggle } from '@/components/pages/lock-toggle';
import { VersionHistory } from '@/components/pages/version-history';
import { MoveToPicker } from '@/components/sidebar/move-to-picker';
import { IconTooltip, TooltipProvider } from '@/components/ui/tooltip';
import type { MemberRole } from '@/lib/auth/require-role';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.4 #93 — Shared single-open-panel controller for the page-detail action
 * bar. Hoists "which panel is open" into one piece of state so opening any one
 * of comments / version-history / export / lock structurally closes the others
 * (mutual exclusion is not coordinated by side-effects), and a single Escape
 * handler dismisses whichever is open.
 *
 * Each child panel becomes controlled via `open` / `onOpenChange`; their
 * internal mechanics (fetch, render) are untouched — only open-state ownership
 * moves up here. The radix DropdownMenu (export) also closes itself on Escape
 * and outside-click; routing its `onOpenChange` through the controller keeps
 * this component authoritative, and the controller's own Escape listener is an
 * idempotent second path (calling `setActive(null)` twice is harmless).
 */
type ActivePanel = 'comments' | 'versions' | 'export' | 'lock' | null;

type PageActionPanelsProps = {
  pageId: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
  canEditVersions: boolean;
  canLock: boolean;
  // v0.9.6 #124 — show the Move-To affordance to users who can reparent
  // (editor+). The reparent itself is still editor-gated by the move route.
  canMove: boolean;
};

export function PageActionPanels({
  pageId,
  canComment,
  currentUserId,
  currentRole,
  canEditVersions,
  canLock,
  canMove,
}: PageActionPanelsProps) {
  const t = useT();
  const router = useRouter();
  const [active, setActive] = useState<ActivePanel>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  // Single keydown listener dismisses the open panel on Escape. For the
  // non-radix surfaces (the comments + versions drawers) this is the dismissal
  // path; for the radix DropdownMenu it is idempotent with radix's own Escape.
  useEffect(() => {
    if (active == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActive(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  const bind = (id: Exclude<ActivePanel, null>) => ({
    open: active === id,
    onOpenChange: (open: boolean) => setActive(open ? id : null),
  });

  return (
    <TooltipProvider delayDuration={300}>
      {/* The grouping separator that preceded the action cluster in page.tsx
          lives here so the action-bar grouping is preserved. */}
      <span className="h-6 w-px shrink-0 self-center bg-border" aria-hidden="true" />
      {/* Each toggle renders a Button + (when open) a sibling drawer as a
          fragment, so the IconTooltip wraps them in a `display:contents` span:
          the span is the radix Trigger (focus/hover bubble up to it from the
          inner button) without adding layout, and the inner button keeps its
          own aria-label as the accessible name. */}
      <IconTooltip label={t('pageActions.tooltip.comments')} side="bottom">
        <span className="contents">
          <CommentsToggle
            pageId={pageId}
            canComment={canComment}
            currentUserId={currentUserId}
            currentRole={currentRole}
            {...bind('comments')}
          />
        </span>
      </IconTooltip>
      <IconTooltip label={t('pageActions.tooltip.history')} side="bottom">
        <span className="contents">
          <VersionHistory pageId={pageId} canEdit={canEditVersions} {...bind('versions')} />
        </span>
      </IconTooltip>
      <PageExportMenu pageId={pageId} {...bind('export')} />
      {canLock && (
        <IconTooltip label={t('pageActions.tooltip.lock')} side="bottom">
          <span className="contents">
            <LockToggle pageId={pageId} {...bind('lock')} />
          </span>
        </IconTooltip>
      )}
      {canMove && (
        <>
          <button
            type="button"
            aria-label={t('pageMenu.moveTo')}
            title={t('pageMenu.moveTo')}
            onClick={() => setMoveOpen(true)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring outline-hidden"
          >
            <FolderInput aria-hidden="true" className="h-4 w-4" />
          </button>
          <MoveToPicker
            open={moveOpen}
            sourceId={pageId}
            onOpenChange={setMoveOpen}
            onMoved={() => router.refresh()}
          />
        </>
      )}
    </TooltipProvider>
  );
}
