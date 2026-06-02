'use client';

import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CommentPanel } from '@/components/comments/comment-panel';
import { Button } from '@/components/ui/button';
import type { MemberRole } from '@/lib/auth/require-role';
import { useT } from '@/lib/i18n/provider';

type CommentsToggleProps = {
  pageId: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
  /**
   * Optional controlled open-state (used by the shared page-action-panels
   * controller for single-open mutual exclusion). When omitted the toggle
   * self-manages, so it stays usable standalone and in tests.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CommentsToggle({
  pageId,
  canComment,
  currentUserId,
  currentRole,
  open: controlledOpen,
  onOpenChange,
}: CommentsToggleProps) {
  const t = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );

  // #275 — the selection bubble toolbar (and ⌘⇧M) dispatch a
  // `cairn:editor:comment-selection` window event when the user wants to comment
  // on the current selection. Opening the comments rail here keeps the rail the
  // single owner of the composer; the rail is anchored to the live selection.
  useEffect(() => {
    const onCommentSelection = () => setOpen(true);
    window.addEventListener('cairn:editor:comment-selection', onCommentSelection);
    return () => window.removeEventListener('cairn:editor:comment-selection', onCommentSelection);
  }, [setOpen]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('pageActions.comments.title')}
        aria-pressed={open}
        onClick={() => setOpen(!open)}
      >
        <MessageSquare aria-hidden="true" className="h-4 w-4" />
      </Button>
      {open && (
        <div data-cairn-comments-rail="" className="fixed inset-y-0 right-0 z-30 shadow-lg">
          <CommentPanel
            pageId={pageId}
            canComment={canComment}
            currentUserId={currentUserId}
            currentRole={currentRole}
            open={open}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
