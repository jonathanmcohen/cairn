'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AUDIT_ACTIONS, type AuditAction, type AuditTargetType } from '@/lib/audit/actions';

type AuditEntry = {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
};

type AuditResponse = {
  entries: AuditEntry[];
  nextCursor: string | null;
};

const TARGET_TYPES: AuditTargetType[] = [
  'page',
  'database',
  'workspace',
  'member',
  'api_key',
  'webhook',
  'invite',
  'template',
  'personal_access_token',
  'page_acl',
  'webauthn_credential',
  'mfa_policy',
  // v0.9.0 G2 P11 — Spaces target types.
  'space',
  'space_member',
];

// Human-readable labels for the documented action vocabulary (spec §2.27, §3 G1).
const ACTION_LABEL: Record<AuditAction, string> = {
  'member.role_changed': 'Member role changed',
  'member.removed': 'Member removed',
  'invite.created': 'Invite created',
  'invite.revoked': 'Invite revoked',
  'page.published': 'Page published',
  'page.unpublished': 'Page unpublished',
  'page.share_changed': 'Page share settings changed',
  'page.deleted': 'Page deleted',
  'page.version_restored': 'Page version restored',
  'database.deleted': 'Database deleted',
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
  'webhook.created': 'Webhook created',
  'webhook.deleted': 'Webhook deleted',
  'webhook.secret_rotated': 'Webhook secret rotated',
  'template.created': 'Template created',
  'workspace.settings_changed': 'Workspace settings changed',
  'workspace.ownership_transferred': 'Workspace ownership transferred',
  'workspace.deleted': 'Workspace deleted',
  // v0.7.0 G1 P5 — personal-access-token + page-ACL events.
  'pat.created': 'Personal access token created',
  'pat.revoked': 'Personal access token revoked',
  'pat.expired': 'Personal access token expired',
  // v0.9.0 G1 P9 — PAT quota events.
  'pat.quota_exceeded': 'Personal access token quota exceeded',
  // v0.9.0 G1 P10 — admin cleared a PAT's day+month rollup rows.
  'pat.quota_reset': 'Personal access token quota reset',
  'page_acl.created': 'Page ACL granted',
  'page_acl.changed': 'Page ACL permission changed',
  'page_acl.removed': 'Page ACL removed',
  // v0.8.0 G3 P8 — quick-capture inbox events.
  'inbox.captured': 'Inbox capture saved',
  'inbox.triaged': 'Inbox item triaged',
  // v0.9.0 G1 P1 — SSO bundle events.
  'sso.idp.created': 'SSO identity provider created',
  'sso.idp.updated': 'SSO identity provider updated',
  'sso.idp.deleted': 'SSO identity provider deleted',
  'sso.scim.token.minted': 'SCIM token minted',
  'sso.scim.token.revoked': 'SCIM token revoked',
  // v0.9.0 G1 P5-P7 — E2E encryption lifecycle events.
  'e2e.keypair.created': 'E2E keypair created',
  'e2e.page.encrypted': 'Page encrypted (E2E)',
  'e2e.workspace.encrypted': 'Workspace encrypted (E2E)',
  'e2e.workspace.member_added': 'E2E workspace member added',
  'e2e.workspace.member_removed': 'E2E workspace member removed',
  'e2e.workspace.rekey_started': 'E2E workspace rekey started',
  'e2e.workspace.rekey_completed': 'E2E workspace rekey completed',
  // v0.9.0 G1 P8 — WebAuthn + step-up + admin-enforce events.
  'mfa.passkey_added': 'Passkey added',
  'mfa.passkey_removed': 'Passkey removed',
  'mfa.passkey_used': 'Passkey used',
  'mfa.stepup_required': 'Step-up required',
  'mfa.policy_changed': 'MFA policy changed',
  // v0.9.0 G2 P11 — Spaces lifecycle + per-space ACL events.
  'space.created': 'Space created',
  'space.updated': 'Space updated',
  'space.deleted': 'Space deleted',
  'space.member_added': 'Space member added',
  'space.member_removed': 'Space member removed',
  'page.moved_space': 'Page moved between spaces',
};

function actionLabel(action: string): string {
  return (ACTION_LABEL as Record<string, string>)[action] ?? action;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

type Filters = {
  action: string;
  targetType: string;
  from: string;
  to: string;
};

function buildQuery(f: Filters, cursor: string | null): string {
  const p = new URLSearchParams();
  if (f.action) p.set('action', f.action);
  if (f.targetType) p.set('targetType', f.targetType);
  // `<input type="date">` returns yyyy-mm-dd; widen to a full ISO instant so
  // the backend's z.string().datetime() validator accepts it.
  if (f.from) p.set('from', `${f.from}T00:00:00.000Z`);
  if (f.to) p.set('to', `${f.to}T00:00:00.000Z`);
  if (cursor) p.set('cursor', cursor);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export function AuditViewer() {
  const [filters, setFilters] = useState<Filters>({
    action: '',
    targetType: '',
    from: '',
    to: '',
  });
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchFirst = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit${buildQuery(f, null)}`);
      if (!res.ok) {
        setError(`Failed to load audit log (${res.status})`);
        setEntries([]);
        setNextCursor(null);
        return;
      }
      const body = (await res.json()) as AuditResponse;
      setEntries(body.entries);
      setNextCursor(body.nextCursor);
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit${buildQuery(filters, nextCursor)}`);
      if (!res.ok) {
        setError(`Failed to load more (${res.status})`);
        return;
      }
      const body = (await res.json()) as AuditResponse;
      setEntries((prev) => [...prev, ...body.entries]);
      setNextCursor(body.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  // Refetch from the start whenever a filter changes (and on mount).
  useEffect(() => {
    void fetchFirst(filters);
  }, [fetchFirst, filters]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">Action</span>
          <select
            aria-label="Filter by action"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">Target type</span>
          <select
            aria-label="Filter by target type"
            value={filters.targetType}
            onChange={(e) => setFilters((f) => ({ ...f, targetType: e.target.value }))}
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="">All targets</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">From</span>
          <input
            type="date"
            aria-label="Filter from date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">To</span>
          <input
            type="date"
            aria-label="Filter to date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="rounded border px-2 py-1 text-sm"
          />
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Action</th>
              <th className="py-2">Actor</th>
              <th className="py-2">Target</th>
              <th className="py-2">When</th>
              <th className="py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground py-4 text-center">
                  No audit entries match these filters.
                </td>
              </tr>
            ) : null}
            {entries.map((entry) => {
              const isOpen = !!expanded[entry.id];
              const actor = entry.actorUserId ? entry.actorUserId.slice(0, 8) : '—';
              const target = entry.targetType
                ? `${entry.targetType}${entry.targetId ? `:${entry.targetId.slice(0, 8)}` : ''}`
                : '—';
              return (
                <tr key={entry.id} className="border-b align-top">
                  <td className="py-2 pr-3">{actionLabel(entry.action)}</td>
                  <td className="text-muted-foreground py-2 pr-3 font-mono text-xs">{actor}</td>
                  <td className="text-muted-foreground py-2 pr-3 font-mono text-xs">{target}</td>
                  <td className="text-muted-foreground py-2 pr-3" title={entry.createdAt}>
                    {relativeTime(entry.createdAt)}
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-xs underline hover:no-underline"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded((m) => ({ ...m, [entry.id]: !m[entry.id] }))}
                    >
                      {isOpen ? 'Hide' : 'Show'}
                    </button>
                    {isOpen ? (
                      <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
