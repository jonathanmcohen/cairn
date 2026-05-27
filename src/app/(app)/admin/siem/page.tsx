/**
 * v0.9.0 G8 P39 — SIEM forwarders admin UI (admin-only RSC).
 *
 * Lists every forwarder in the caller's workspace, with create/edit/delete +
 * test actions. The form + test-button are Client Components; this RSC only
 * forwards plain string/boolean values to them (no function props from RSC
 * to Client). Credentials are NEVER passed through here — the API redacts on
 * read; the form re-posts the secret only when the operator explicitly types
 * one.
 */

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { ForwarderForm } from './forwarder-form';

export const dynamic = 'force-dynamic';

export default async function SiemAdminPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');

  const forwarders = await getDb()
    .select({
      id: schema.siemForwarders.id,
      kind: schema.siemForwarders.kind,
      name: schema.siemForwarders.name,
      endpoint: schema.siemForwarders.endpoint,
      enabled: schema.siemForwarders.enabled,
      hasCredential: schema.siemForwarders.credentialSecret,
    })
    .from(schema.siemForwarders)
    .where(eq(schema.siemForwarders.workspaceId, ctx.workspaceId));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">SIEM forwarders</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Forward every audit event to a syslog endpoint or HTTP webhook. Use this to feed your SOC,
          observability platform, or compliance log archive. Failed deliveries retry on an
          exponential backoff and the per-attempt history is recorded for review.
        </p>
      </header>

      <section aria-labelledby="forwarders-list" className="space-y-4">
        <h2 id="forwarders-list" className="text-lg font-medium">
          Configured forwarders
        </h2>
        {forwarders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No forwarders configured yet.</p>
        ) : (
          <ul className="space-y-3">
            {forwarders.map((f) => (
              <li
                key={f.id}
                className="rounded-md border p-4 text-sm"
                data-testid="siem-forwarder-row"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {f.name} <span className="text-muted-foreground text-xs">({f.kind})</span>
                    </div>
                    <div className="text-muted-foreground text-xs">{f.endpoint}</div>
                  </div>
                  <div className="text-xs">
                    {f.enabled ? (
                      <span className="rounded bg-green-100 px-2 py-1 text-green-800 dark:bg-green-900 dark:text-green-100">
                        enabled
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-2 py-1">disabled</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-forwarder" className="space-y-4">
        <h2 id="add-forwarder" className="text-lg font-medium">
          Add a forwarder
        </h2>
        <ForwarderForm />
      </section>
    </div>
  );
}
