import { sql } from 'drizzle-orm';
import type { Route } from 'next';
import semver from 'semver';
import { UpgradeApplyButton } from '@/components/admin/upgrade-apply-button';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
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

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Upgrade"
      />
      <h1 className="mb-4 font-semibold text-xl">Cairn upgrade</h1>
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
