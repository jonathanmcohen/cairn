'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

type SpaceRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: number;
};

type Member = {
  userId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  name: string | null;
  email: string;
};

/**
 * Admin-side CRUD + members editor for spaces. Posts to /api/spaces and
 * /api/spaces/[id]/members; uses router.refresh() to re-fetch the RSC list
 * after each mutation so the table stays in sync without local cache.
 */
export function SpacesManager({ spaces }: { spaces: SpaceRow[] }) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const slugId = useId();
  const iconId = useId();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [icon, setIcon] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Per-space members panel state. Open one at a time.
  const [openMembersId, setOpenMembersId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<Member['role']>('editor');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          icon: icon ? icon : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to create space (${res.status})`);
        return;
      }
      setName('');
      setSlug('');
      setIcon('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(spaceId: string) {
    setError(null);
    setBusyId(spaceId);
    try {
      const res = await fetch(`/api/spaces/${spaceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to delete (${res.status})`);
        return;
      }
      if (openMembersId === spaceId) setOpenMembersId(null);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function openMembers(spaceId: string) {
    setError(null);
    setOpenMembersId(spaceId);
    setMembers([]);
    const res = await fetch(`/api/spaces/${spaceId}/members`);
    if (res.ok) {
      const body = (await res.json()) as { members: Member[] };
      setMembers(body.members);
    }
  }

  async function addMember(spaceId: string) {
    setError(null);
    const userId = addUserId.trim();
    if (!userId) return;
    const res = await fetch(`/api/spaces/${spaceId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role: addRole }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Failed to add member (${res.status})`);
      return;
    }
    setAddUserId('');
    void openMembers(spaceId);
  }

  async function removeMember(spaceId: string, userId: string) {
    const res = await fetch(`/api/spaces/${spaceId}/members?userId=${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Failed to remove (${res.status})`);
      return;
    }
    setMembers((m) => m.filter((x) => x.userId !== userId));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-md border p-4">
        <div className="grid gap-1">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
            required
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={slugId}>Slug</Label>
          <Input
            id={slugId}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="engineering"
            required
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={iconId}>Icon (emoji, optional)</Label>
          <Input
            id={iconId}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="📁"
            maxLength={8}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button type="submit" disabled={submitting || !name || !slug}>
            {submitting ? 'Creating…' : 'Create space'}
          </Button>
        </div>
      </form>

      <ul className="divide-y rounded-md border">
        {spaces.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">No spaces yet.</li>
        )}
        {spaces.map((s) => (
          <li key={s.id} className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  {s.icon ? `${s.icon} ` : ''}
                  {s.name}
                </div>
                <div className="text-xs text-muted-foreground">/{s.slug}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    openMembersId === s.id ? setOpenMembersId(null) : void openMembers(s.id)
                  }
                >
                  {openMembersId === s.id ? 'Hide members' : 'Members'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(s.id)}
                  disabled={busyId === s.id}
                >
                  Delete
                </Button>
              </div>
            </div>

            {openMembersId === s.id && (
              <div className="space-y-2 rounded border bg-muted/30 p-2">
                <ul className="space-y-1">
                  {members.length === 0 && (
                    <li className="text-xs text-muted-foreground">
                      No explicit members — every workspace member can see this space.
                    </li>
                  )}
                  {members.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between text-sm">
                      <span>
                        {m.name ?? m.email}{' '}
                        <span className="text-xs text-muted-foreground">({m.role})</span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember(s.id, m.userId)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addMember(s.id);
                  }}
                  className="flex flex-wrap items-center gap-2 pt-2"
                >
                  <Input
                    className="min-w-0 flex-1"
                    placeholder="user id"
                    value={addUserId}
                    onChange={(e) => setAddUserId(e.target.value)}
                  />
                  <Select
                    value={addRole}
                    onValueChange={(next) => setAddRole(next as Member['role'])}
                  >
                    <SelectTrigger
                      aria-label={t('spaces.memberRoleAriaLabel')}
                      className="w-auto text-sm"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">viewer</SelectItem>
                      <SelectItem value="editor">editor</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="owner">owner</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
