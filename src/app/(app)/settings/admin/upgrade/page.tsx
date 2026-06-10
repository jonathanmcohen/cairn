import { sql } from 'drizzle-orm';
import type { Route } from 'next';
import semver from 'semver';
import { UpgradeApplyButton } from '@/components/admin/upgrade-apply-button';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { isCollabBridgeConfigured } from '@/lib/collab/publish-client';
import { readPackageVersion } from '@/lib/upgrade/version';

export const dynamic = 'force-dynamic';

/**
 * v0.9.0 G8 P42 — admin upgrade page.
 *
 * Renders the bundled `package.json#version` and the latest known available
 * version (from `upgrade_available` notifications inserted by the
 * release-watch cron). The "Apply upgrade now" button is a Client Component
 * that POSTs to `/api/admin/upgrade/apply` and streams the SSE response
 * into a `<pre>` log. No function prop crosses the RSC→Client boundary —
 * the button only receives primitive `disabled` + `releaseNotesUrl`.
 */
export default async function AdminUpgradePage() {
  await requireRole('admin');

  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (payload->>'version') payload
    FROM notifications
    WHERE type = 'upgrade_available'
    ORDER BY payload->>'version', created_at DESC
  `)) as unknown as Array<{ payload: { version: string; releaseNotesUrl: string } }>;

  const ordered = rows
    .filter((r) => semver.valid(r.payload.version))
    .sort((a, b) => semver.rcompare(a.payload.version, b.payload.version));
  const available = ordered[0]?.payload;
  const currentVersion = await readPackageVersion();
  const newer =
    available !== undefined &&
    semver.valid(available.version) &&
    semver.valid(currentVersion) &&
    semver.gt(available.version, currentVersion);

  // v0.9.19 A4 (#A3) — surface a misconfigured REST→Yjs bridge to admins. When
  // CAIRN_COLLAB_INTERNAL_URL is unset, REST PATCH content writes update the DB
  // but never reach an open editor session (the v0.9.18 live miss). Read at
  // request time on the server; the env value itself is never sent to the client.
  const collabBridgeConfigured = isCollabBridgeConfigured();

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Upgrade"
      />
      <h1 className="mb-4 font-semibold text-xl">Cairn upgrade</h1>
      {!collabBridgeConfigured ? (
        <div
          role="status"
          className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
          data-testid="collab-bridge-warning"
        >
          <p className="font-medium">Live-editor sync is disabled</p>
          <p className="mt-1 text-muted-foreground">
            <code>CAIRN_COLLAB_INTERNAL_URL</code> is not set, so REST API writes to a page&rsquo;s
            content update the database but won&rsquo;t reach an open editor until reload. Set it in
            your environment (see <code>docker-compose.yml</code>) to enable the API↔editor bridge.
          </p>
        </div>
      ) : null}
      <p className="mb-4 text-muted-foreground text-sm">
        The release-watch daemon polls the configured release feed and inserts a notification when a
        newer stable tag is published. Use the button below to apply the upgrade in place (snapshot
        → migrate → restart → healthcheck). Auto-apply is off by default.
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <dt className="font-medium">Current version</dt>
        <dd>{currentVersion}</dd>
        <dt className="font-medium">Available version</dt>
        <dd>
          {available && newer ? (
            <>
              {available.version}{' '}
              <a
                className="underline"
                href={available.releaseNotesUrl}
                target="_blank"
                rel="noreferrer"
              >
                Release notes
              </a>
            </>
          ) : (
            <span className="text-muted-foreground">none — up to date</span>
          )}
        </dd>
      </dl>
      <div className="mt-6">
        <UpgradeApplyButton disabled={!newer} />
      </div>
    </section>
  );
}
