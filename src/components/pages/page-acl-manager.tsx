'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';

type Permission = 'view' | 'comment' | 'edit';

type AclRow = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  permission: Permission;
};

type Member = { id: string; name: string; email: string; image: string | null };

type PageAclManagerProps = { pageId: string };

/**
 * "People with access" management surface inside the Share panel. Lists the
 * explicit page_acls grants, lets an editor add a grant (member search +
 * permission select) or remove one. All mutations hit /api/pages/<pageId>/acls.
 * Removal is confirmed through the themed useConfirm() dialog (no native
 * confirm()).
 */
export function PageAclManager({ pageId }: PageAclManagerProps) {
  const t = useT();
  const confirm = useConfirm();
  const [rows, setRows] = useState<AclRow[]>([]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Member[]>([]);
  const [permission, setPermission] = useState<Permission>('view');
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/acls`);
    if (res.ok) {
      const data = (await res.json()) as { acls: AclRow[] };
      setRows(data.acls);
    }
  }, [pageId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setMatches([]);
      return;
    }
    let active = true;
    void fetch(`/api/workspaces/members?q=${encodeURIComponent(query)}`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((data: { members: Member[] }) => {
        if (active) setMatches(data.members);
      })
      .catch(() => {
        if (active) setMatches([]);
      });
    return () => {
      active = false;
    };
  }, [query]);

  async function grant(userId: string): Promise<void> {
    const res = await fetch(`/api/pages/${pageId}/acls`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, permission }),
    });
    if (res.ok) {
      setStatus(t('share.acl.saved'));
      setQuery('');
      setMatches([]);
      await reload();
      setTimeout(() => setStatus(null), 1500);
    } else {
      setStatus(t('share.acl.error'));
    }
  }

  async function remove(row: AclRow): Promise<void> {
    const ok = await confirm({
      title: t('share.acl.removeConfirmTitle'),
      description: t('share.acl.removeConfirmBody', { name: row.name || row.email }),
      confirmLabel: t('share.acl.removeConfirmAction'),
      cancelLabel: t('share.acl.removeConfirmCancel'),
      variant: 'danger',
    });
    if (!ok) return;
    const res = await fetch(`/api/pages/${pageId}/acls`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: row.userId }),
    });
    if (res.ok) {
      setStatus(t('share.acl.saved'));
      await reload();
      setTimeout(() => setStatus(null), 1500);
    } else {
      setStatus(t('share.acl.error'));
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">{t('share.acl.title')}</div>
        <p className="text-muted-foreground text-xs">{t('share.acl.hint')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('share.acl.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.userId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm">
                <span className="font-medium">{row.name || row.email}</span>{' '}
                <span className="text-muted-foreground">{row.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {t(`share.acl.permission.${row.permission}`)}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void remove(row)}>
                  {t('share.acl.remove')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <Label htmlFor="acl-add">{t('share.acl.addMember')}</Label>
        <div className="flex gap-2">
          <Input
            id="acl-add"
            value={query}
            placeholder={t('share.acl.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label={t('share.acl.addMember')}
            className="rounded-md border bg-background px-2 text-sm"
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
          >
            <option value="view">{t('share.acl.permission.view')}</option>
            <option value="comment">{t('share.acl.permission.comment')}</option>
            <option value="edit">{t('share.acl.permission.edit')}</option>
          </select>
        </div>
        {matches.length > 0 && (
          <ul className="rounded-md border">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => void grant(m.id)}
                >
                  <span className="truncate">{m.name || m.email}</span>
                  <span className="text-muted-foreground text-xs">{t('share.acl.add')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status && (
        <div aria-live="polite" className="text-muted-foreground text-xs">
          {status}
        </div>
      )}
    </div>
  );
}
