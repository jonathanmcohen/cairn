'use client';

/**
 * G16 #163 — row "peek" panel. A themed shadcn Dialog that mounts the
 * (previously unreachable) RowComments thread for a single database row, opened
 * from a per-row action in the table view.
 */
import { RowComments } from '@/components/comments/row-comments';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MemberRole } from '@/lib/auth/require-role';
import { useT } from '@/lib/i18n/provider';

export function RowPeekPanel({
  databaseId,
  rowId,
  open,
  onOpenChange,
  canComment,
  currentUserId,
  currentRole,
}: {
  databaseId: string;
  rowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('databases.row.comments')}</DialogTitle>
        </DialogHeader>
        <RowComments
          databaseId={databaseId}
          rowId={rowId}
          canComment={canComment}
          currentUserId={currentUserId}
          currentRole={currentRole}
        />
      </DialogContent>
    </Dialog>
  );
}
