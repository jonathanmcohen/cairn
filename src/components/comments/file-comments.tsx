'use client';

import type { MemberRole } from '@/lib/auth/require-role';
import { TargetCommentPanel } from './target-comment-panel';

type FileCommentsProps = {
  fileId: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
};

/** Comment thread for an uploaded file, wired to the file-comment routes. */
export function FileComments({
  fileId,
  canComment,
  currentUserId,
  currentRole,
}: FileCommentsProps) {
  const url = `/api/files/${fileId}/comments`;
  return (
    <TargetCommentPanel
      target={{ type: 'file', id: fileId }}
      listUrl={url}
      postUrl={url}
      canComment={canComment}
      currentUserId={currentUserId}
      currentRole={currentRole}
    />
  );
}
