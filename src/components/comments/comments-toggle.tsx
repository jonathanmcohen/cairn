'use client';

import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { CommentPanel } from '@/components/comments/comment-panel';
import { Button } from '@/components/ui/button';
import type { MemberRole } from '@/lib/auth/require-role';

type CommentsToggleProps = {
  pageId: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
};

export function CommentsToggle({
  pageId,
  canComment,
  currentUserId,
  currentRole,
}: CommentsToggleProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Comments"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
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
