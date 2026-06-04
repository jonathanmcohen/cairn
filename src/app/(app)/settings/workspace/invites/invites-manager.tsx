'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { CopyButton } from '@/components/settings/copy-button';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

type Role = 'viewer' | 'editor' | 'admin';
type Invite = {
  id: string;
  email: string;
  role: Role | 'owner';
  token: string;
  expiresAt: string;
  createdAt: string;
};

const ROLES: Role[] = ['viewer', 'editor', 'admin'];

/**
 * v0.9.9 K3 #225/#226 — the invite create-form + the resulting copy-link,
 * extracted so the "Invite member" Radix dialog can host it. Owns its own
 * email/role/days/submitting/error/createdLink state. After creation the link
 * stays visible with a real Copy button so the admin can share it.
 */
export function InviteCreateForm({ workspaceId: _workspaceId }: { workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const emailId = useId();
  const roleId = useId();
  const daysId = useId();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [days, setDays] = useState<number>(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedLink(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role, expiresInDays: days }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to create invite (${res.status})`);
        return;
      }
      const body = (await res.json()) as { token: string };
      // The v0.2.0 invite landing lives at /invite/[token]. Show the
      // resulting URL so the admin can copy it (email delivery is optional).
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setCreatedLink(`${origin}/invite/${body.token}`);
      setEmail('');
      router.refresh();
    } finally {
      setSubmitting(false);
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

      <form onSubmit={createInvite} className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor={emailId} className="text-xs text-muted-foreground">
            Email
          </label>
          <input
            id={emailId}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border px-2 py-1"
            placeholder="user@example.com"
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor={roleId} className="text-xs text-muted-foreground">
            Role
          </label>
          <Select value={role} onValueChange={(next) => setRole(next as Role)}>
            <SelectTrigger id={roleId} aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col">
          <label htmlFor={daysId} className="text-xs text-muted-foreground">
            Expires (days)
          </label>
          <input
            id={daysId}
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-24 rounded border px-2 py-1"
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create invite'}
        </Button>
      </form>

      {createdLink ? (
        <div className="mb-2 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <p className="mb-1 font-medium">{t('invites.linkCreated')}</p>
          <div className="flex items-center gap-2">
            <code className="break-all">{createdLink}</code>
            <CopyButton value={createdLink} label={t('invites.copyLink')} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InvitesManager({
  workspaceId,
  invites,
}: {
  workspaceId: string;
  invites: Invite[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(inviteId: string) {
    setError(null);
    setBusyId(inviteId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to revoke invite (${res.status})`);
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

      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Pending invites</h2>
      {invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending invites.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              <th className="py-2">Expires</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className="border-b">
                <td className="py-2">{inv.email}</td>
                <td className="py-2">{inv.role}</td>
                <td className="py-2">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busyId === inv.id}
                    aria-label={`Revoke invite for ${inv.email}`}
                    onClick={() => revoke(inv.id)}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
