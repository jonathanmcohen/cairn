'use client';

import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
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
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

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
