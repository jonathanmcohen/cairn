/**
 * v0.10.0 C4 — selective restore endpoint (admin/owner only, additive).
 *
 * POST `{ts, mode, sourcePageId?|sourceWorkspaceId?, targetWorkspaceId,
 * confirm:true}` starts an in-process selective-restore job
 * (src/lib/backups/selective-restore.ts) and answers 202 with the job id to
 * poll at /api/admin/backups/jobs/[id]. Gates, in order:
 *   - requireRole('admin') in the caller's ACTIVE workspace (same gate as the
 *     rest of the /api/admin surface — backups are instance-level);
 *   - the caller must ALSO be admin/owner of the TARGET workspace: requireRole
 *     resolves the active workspace from the session cookie, so when
 *     targetWorkspaceId differs we verify the membership row explicitly (the
 *     same workspace_members lookup requireRole performs internally) → 403;
 *   - bundle must exist in CAIRN_BACKUP_DIR → 404;
 *   - encrypted bundle without the passphrase env → upfront 400;
 *   - snapshot manifest MAJOR.MINOR newer than the running app → 400 naming
 *     both versions.
 *
 * No retype/maintenance gate, unlike the destructive C2 restore: a selective
 * restore only INSERTs new rows (new ids), so the worst-case outcome is an
 * unwanted copy the admin can delete — `confirm: true` in the body (a checked
 * box in the UI) is proportionate.
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, hasMinRole, requireRole } from '@/lib/auth/require-role';
import { startSelectiveRestoreJob } from '@/lib/backups/selective-restore';
import { env } from '@/lib/env';

const Body = z
  .object({
    // Bundle slug characters only — see the C2 restore route (path-traversal
    // guard when joined into the bundle filename).
    ts: z.string().regex(/^[A-Za-z0-9-]+$/),
    mode: z.enum(['page', 'workspace']),
    sourcePageId: z.uuid().optional(),
    sourceWorkspaceId: z.uuid().optional(),
    targetWorkspaceId: z.uuid(),
    confirm: z.literal(true),
  })
  .refine((b) => (b.mode === 'page' ? Boolean(b.sourcePageId) : Boolean(b.sourceWorkspaceId)), {
    message: 'mode page requires sourcePageId; mode workspace requires sourceWorkspaceId',
  });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    const body = parsed.data;

    // Target-workspace role check (the active-workspace gate above only
    // covers ctx.workspaceId).
    if (body.targetWorkspaceId !== ctx.workspaceId) {
      const [membership] = await getDb()
        .select({ role: schema.workspaceMembers.role })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, body.targetWorkspaceId),
            eq(schema.workspaceMembers.userId, ctx.userId),
          ),
        )
        .limit(1);
      if (!membership || !hasMinRole(membership.role, 'admin')) {
        return NextResponse.json(
          { error: 'requires admin role in the target workspace' },
          { status: 403 },
        );
      }
    }

    const selection =
      body.mode === 'page'
        ? ({ mode: 'page', sourcePageId: body.sourcePageId as string } as const)
        : ({ mode: 'workspace', sourceWorkspaceId: body.sourceWorkspaceId as string } as const);

    const result = await startSelectiveRestoreJob({
      dir: env().CAIRN_BACKUP_DIR,
      ts: body.ts,
      selection,
      targetWorkspaceId: body.targetWorkspaceId,
      restoredBy: ctx.userId,
      databaseUrl: env().DATABASE_URL,
    });
    if (!result.ok) {
      switch (result.error) {
        case 'bundle-missing':
          return NextResponse.json({ error: 'bundle-missing' }, { status: 404 });
        case 'encrypted-passphrase-missing':
          return NextResponse.json(
            {
              error:
                'bundle is encrypted but CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset on the server',
            },
            { status: 400 },
          );
        case 'snapshot-version-newer':
          return NextResponse.json(
            {
              error: `snapshot version ${result.snapshotVersion} is newer than this app (${result.currentVersion}); upgrade the app before restoring from it`,
            },
            { status: 400 },
          );
      }
    }
    return NextResponse.json({ jobId: result.job.id }, { status: 202 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
