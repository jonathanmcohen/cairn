/**
 * v0.9.0 G8 P39 — SIEM forwarder list + create (admin-only).
 *
 * GET returns the forwarder rows for the caller's workspace, with
 * `credentialSecret` redacted to a fixed sentinel (operators see whether a
 * secret is set but never the value).
 *
 * POST creates a new forwarder. Body is a discriminated union on `kind`:
 * `syslog` and `http` ship in this plan; P40 adds `splunk_hec | datadog | s3`
 * to the schema enum + Zod union without touching this route. Records a
 * `workspace.settings_changed` audit row whose metadata records the
 * forwarder kind + name + endpoint — never the credential secret.
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const Kind = z.enum(['syslog', 'http']);

const CreateBody = z.object({
  kind: Kind,
  name: z.string().min(1).max(120),
  endpoint: z.string().min(1).max(2_000),
  credentialSecret: z.string().min(1).max(2_000).nullable().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const REDACTED_SECRET = '••••••••';

function redact(row: schema.SiemForwarder): Omit<schema.SiemForwarder, 'credentialSecret'> & {
  credentialSecret: string | null;
  hasCredential: boolean;
} {
  return {
    ...row,
    credentialSecret: row.credentialSecret ? REDACTED_SECRET : null,
    hasCredential: row.credentialSecret !== null,
  };
}

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const rows = await getDb()
      .select()
      .from(schema.siemForwarders)
      .where(eq(schema.siemForwarders.workspaceId, ctx.workspaceId));
    return NextResponse.json({ forwarders: rows.map(redact) });
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

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = CreateBody.parse(await req.json());
    const db = getDb();

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.siemForwarders)
        .values({
          workspaceId: ctx.workspaceId,
          kind: parsed.kind,
          name: parsed.name,
          endpoint: parsed.endpoint,
          credentialSecret: parsed.credentialSecret ?? null,
          options: parsed.options ?? {},
          enabled: parsed.enabled ?? true,
        })
        .returning();
      if (!created) throw new Error('siem forwarder insert returned no row');

      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: ctx.workspaceId,
        metadata: {
          siem: {
            op: 'forwarder_created',
            forwarderId: created.id,
            kind: created.kind,
            name: created.name,
            endpoint: created.endpoint,
            hasCredential: created.credentialSecret !== null,
          },
        },
      });

      return created;
    });

    return NextResponse.json({ forwarder: redact(row) }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
