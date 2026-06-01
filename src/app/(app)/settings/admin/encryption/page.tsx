import { eq } from 'drizzle-orm';
import type { Route } from 'next';
import { EncryptionDisabledNotice } from '@/components/admin/encryption-disabled-notice';
import { WorkspaceE2EToggle } from '@/components/admin/workspace-e2e-toggle';
import { WorkspaceRekeyAction } from '@/components/admin/workspace-rekey-action';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { workspaces } from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';

/**
 * v0.9.0 G1 P7 — admin-scoped page for the workspace-wide E2E toggle.
 *
 * Server Component. Gates on `requireRole('admin')` and renders the client
 * toggle. When the build-time flag NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION
 * is false, we render a disabled-state explanation instead of the toggle.
 *
 * The toggle is irreversible-by-design: once flipped, the only way back
 * is restore-from-backup. Member churn flows through the separate rekey
 * action (still admin-only).
 */
export default async function AdminEncryptionPage() {
  const ctx = await requireRole('admin');

  const [ws] = await getDb()
    .select({ e2eMode: workspaces.e2eMode })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId));

  const mode = (ws?.e2eMode ?? 'off') as 'off' | 'per_page' | 'workspace_wide';
  const flagOn = env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION;

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Encryption"
      />
      <h1 className="mb-4 font-semibold text-xl">Workspace encryption</h1>
      <p className="mb-4 text-muted-foreground text-sm">
        Encrypt every page in this workspace under a single workspace key (WSK). The server never
        holds the key — only its wrapped form for each member.
      </p>
      {flagOn ? (
        <>
          <WorkspaceE2EToggle workspaceId={ctx.workspaceId} initialMode={mode} />
          {mode === 'workspace_wide' ? (
            <div className="mt-6">
              <WorkspaceRekeyAction workspaceId={ctx.workspaceId} />
            </div>
          ) : null}
        </>
      ) : (
        <EncryptionDisabledNotice />
      )}
    </section>
  );
}
