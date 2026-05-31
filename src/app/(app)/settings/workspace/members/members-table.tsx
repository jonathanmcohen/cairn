'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Member = {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
};

const EDITABLE_ROLES = ['viewer', 'editor', 'admin'] as const;
type EditableRole = (typeof EDITABLE_ROLES)[number];

// Roles are stored lowercase ('owner' | 'admin' | …). Display them Title-Cased
// without ever changing the stored value or the <option value> (#63).
const ROLE_LABELS: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export function MembersTable({
  workspaceId,
  members,
  currentUserId,
}: {
  workspaceId: string;
  members: Member[];
  currentUserId: string;
}) {
  const router = useRouter();
  // userId being mutated (role or remove); used to disable controls on that row
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(userId: string, role: EditableRole) {
    setError(null);
    setBusyId(userId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to change role (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(userId: string) {
    setError(null);
    setBusyId(userId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to remove member (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Name</th>
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const isOwner = m.role === 'owner';
            // Owners are read-only here (transfer-ownership is a separate flow);
            // you can't modify yourself.
            const roleLocked = isOwner || isSelf;
            return (
              <tr key={m.userId} className="border-b">
                <td className="max-w-[16rem] truncate py-2" title={m.name}>
                  {m.name}
                </td>
                <td className="max-w-[16rem] truncate py-2" title={m.email}>
                  {m.email}
                </td>
                <td className="py-2">
                  {roleLocked ? (
                    <span>{ROLE_LABELS[m.role]}</span>
                  ) : (
                    <Select
                      value={m.role}
                      disabled={busyId === m.userId}
                      onValueChange={(next) => changeRole(m.userId, next as EditableRole)}
                    >
                      <SelectTrigger aria-label={`Change role for ${m.email}`} className="w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EDITABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="py-2 text-right">
                  {/* #62: never offer Remove on the owner row or your own row —
                      removing the last owner / yourself is blocked server-side
                      (admin-members.ts), but the control must not appear at all. */}
                  {isOwner || isSelf ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busyId === m.userId}
                      aria-label={`Remove ${m.email}`}
                      onClick={() => removeUser(m.userId)}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
