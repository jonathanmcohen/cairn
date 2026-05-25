'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Member = {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
};

const EDITABLE_ROLES = ['viewer', 'editor', 'admin'] as const;
type EditableRole = (typeof EDITABLE_ROLES)[number];

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
            // Removing owners is blocked by the API; removing yourself goes
            // through the leave flow, not the admin console.
            const removeDisabled = isOwner || isSelf || busyId === m.userId;
            return (
              <tr key={m.userId} className="border-b">
                <td className="py-2">{m.name}</td>
                <td className="py-2">{m.email}</td>
                <td className="py-2">
                  {roleLocked ? (
                    <span>{m.role}</span>
                  ) : (
                    <select
                      aria-label={`Change role for ${m.email}`}
                      value={m.role}
                      disabled={busyId === m.userId}
                      onChange={(e) => changeRole(m.userId, e.target.value as EditableRole)}
                      className="rounded border px-2 py-1"
                    >
                      {EDITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={removeDisabled}
                    aria-label={`Remove ${m.email}`}
                    onClick={() => removeUser(m.userId)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
