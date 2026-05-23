'use client';

import type { MemberRole } from '@/lib/auth/require-role';
import { TargetCommentPanel } from './target-comment-panel';

type RowCommentsProps = {
  databaseId: string;
  rowId: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
};

/** Comment thread for a single database row, wired to the row-comment routes. */
export function RowComments({
  databaseId,
  rowId,
  canComment,
  currentUserId,
  currentRole,
}: RowCommentsProps) {
  const url = `/api/databases/${databaseId}/rows/${rowId}/comments`;
  return (
    <TargetCommentPanel
      target={{ type: 'db_row', id: rowId }}
      listUrl={url}
      postUrl={url}
      canComment={canComment}
      currentUserId={currentUserId}
      currentRole={currentRole}
    />
  );
}
