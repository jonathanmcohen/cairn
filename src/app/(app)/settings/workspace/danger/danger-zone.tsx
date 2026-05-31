'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { StepUpModal } from '@/components/security/stepup-modal';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Member = { userId: string; name: string; email: string; role: string };

export function DangerZone({
  workspaceId,
  workspaceName,
  actorUserId,
  members,
}: {
  workspaceId: string;
  workspaceName: string;
  actorUserId: string;
  members: Member[];
}) {
  const router = useRouter();
  const transferSelectId = useId();
  const transferConfirmId = useId();
  const deleteConfirmId = useId();

  // Transfer ownership state.
  const others = members.filter((m) => m.userId !== actorUserId);
  const [toUserId, setToUserId] = useState<string>(others[0]?.userId ?? '');
  const [transferConfirmName, setTransferConfirmName] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Delete workspace state.
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const canTransfer = !!toUserId && transferConfirmName === workspaceName && !transferring;
  const canDelete = deleteConfirmName === workspaceName && !deleting;

  async function onTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError(null);
    setTransferring(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toUserId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setTransferError(b?.error ?? `Failed to transfer (${res.status})`);
        return;
      }
      // Ownership has moved; this user is now an admin. Refresh so the page
      // gate re-evaluates and the nav reflects the new role.
      router.refresh();
    } finally {
      setTransferring(false);
    }
  }

  async function performDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (res.status === 403 && b?.code === 'stepup-required') {
          setStepUpOpen(true);
          return;
        }
        setDeleteError(b?.error ?? `Failed to delete (${res.status})`);
        return;
      }
      // Workspace is gone. Push back to root; getAuthContext will pick a
      // remaining workspace or show the empty state.
      router.push('/');
    } finally {
      setDeleting(false);
    }
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    await performDelete();
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Transfer ownership */}
      <form
        onSubmit={onTransfer}
        className="rounded border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
      >
        <h2 className="mb-2 text-base font-semibold">Transfer ownership</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Promote another member to owner. You will be demoted to <code>admin</code>.
        </p>
        {transferError ? (
          <div
            role="alert"
            className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          >
            {transferError}
          </div>
        ) : null}

        <div className="mb-3 flex flex-col gap-1">
          <label htmlFor={transferSelectId} className="text-sm font-medium">
            New owner
          </label>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other members yet — invite someone first.
            </p>
          ) : (
            <Select value={toUserId} onValueChange={(next) => setToUserId(next)}>
              <SelectTrigger id={transferSelectId} aria-label="New owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {others.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name} ({m.email}) — {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="mb-3 flex flex-col gap-1">
          <label htmlFor={transferConfirmId} className="text-sm font-medium">
            Type <code>{workspaceName}</code> to confirm
          </label>
          <input
            id={transferConfirmId}
            type="text"
            value={transferConfirmName}
            onChange={(e) => setTransferConfirmName(e.target.value)}
            className="rounded border px-2 py-1"
            autoComplete="off"
          />
        </div>

        <Button type="submit" disabled={!canTransfer || others.length === 0}>
          {transferring ? 'Transferring…' : 'Transfer ownership'}
        </Button>
      </form>

      {/* Delete workspace */}
      <form
        onSubmit={onDelete}
        className="rounded border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"
      >
        <h2 className="mb-2 text-base font-semibold text-red-900 dark:text-red-200">
          Delete workspace
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Permanently delete this workspace and everything in it: pages, databases, files, comments,
          and history. This cannot be undone.
        </p>
        {deleteError ? (
          <div
            role="alert"
            className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          >
            {deleteError}
          </div>
        ) : null}

        <div className="mb-3 flex flex-col gap-1">
          <label htmlFor={deleteConfirmId} className="text-sm font-medium">
            Type <code>{workspaceName}</code> to confirm
          </label>
          <input
            id={deleteConfirmId}
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            className="rounded border px-2 py-1"
            autoComplete="off"
          />
        </div>

        <Button type="submit" variant="destructive" disabled={!canDelete}>
          {deleting ? 'Deleting…' : 'Delete workspace permanently'}
        </Button>
      </form>

      {stepUpOpen ? (
        <StepUpModal
          open={stepUpOpen}
          onOpenChange={setStepUpOpen}
          onComplete={async () => {
            setStepUpOpen(false);
            await performDelete();
          }}
        />
      ) : null}
    </div>
  );
}
