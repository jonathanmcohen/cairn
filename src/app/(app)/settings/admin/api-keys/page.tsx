import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { listWorkspacePats } from '@/lib/auth/pat-admin-list';
import { requireRole } from '@/lib/auth/require-role';
import { PatRow } from './pat-row';
import { Sparkline } from './sparkline';

/**
 * Workspace-admin view of every PAT in the active workspace, with live usage
 * counters + 14d sparkline + a per-row "Reset quota" button.
 *
 * Server component — DB read happens here. Re-fetch on action is driven by
 * the client child via `router.refresh()` so RSC re-runs and reads the
 * post-reset counters from the DB; no client-side polling.
 *
 * Admin-only via `requireRole('admin')`. The same gate also guarantees the
 * caller has an active workspace context.
 *
 * v0.9.0 G1 P10.
 */
export const dynamic = 'force-dynamic';

export default async function AdminApiKeysPage() {
  const ctx = await requireRole('admin');
  const rows = await listWorkspacePats(getDb(), ctx.workspaceId);

  return (
    <section className="space-y-4">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="API keys"
      />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">API keys (workspace-wide)</h1>
        <p className="text-sm text-muted-foreground">
          Every personal access token in this workspace. Reset usage counters without revoking the
          token.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No personal access tokens have been minted in this workspace yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Name
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Scopes
                </th>
                <th scope="col" className="px-3 py-2">
                  Daily
                </th>
                <th scope="col" className="px-3 py-2">
                  Monthly
                </th>
                <th scope="col" className="px-3 py-2">
                  14d
                </th>
                <th scope="col" className="px-3 py-2">
                  Last used
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    <div>{r.ownerName ?? r.ownerEmail}</div>
                    <div className="text-xs text-muted-foreground">{r.ownerEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.scopes.join(', ')}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.dailyRequestLimit
                      ? `${r.currentDayUsage} / ${r.dailyRequestLimit}`
                      : `${r.currentDayUsage} / ∞`}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.monthlyRequestLimit
                      ? `${r.currentMonthUsage} / ${r.monthlyRequestLimit}`
                      : `${r.currentMonthUsage} / ∞`}
                  </td>
                  <td className="px-3 py-2">
                    <Sparkline values={r.last14Days} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleString() : 'never'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <PatRow tokenId={r.id} name={r.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
