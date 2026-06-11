/**
 * v0.10.0 D3 — GET /api/admin/oauth-clients (admin/owner-only).
 *
 * Lists every RFC 7591 dynamically-registered OAuth client APPLICATION on the
 * instance with per-client grant counts. Registration itself is
 * unauthenticated by design (`POST /api/oauth/register`), so without this
 * surface an operator has no way to even see what self-registered. Clients
 * are instance-level rows (no workspace column); the gate is the caller being
 * admin/owner of their active workspace — same posture as the backups/SIEM
 * admin routes. `client_secret_hash` is never returned; `confidential` is the
 * derived boolean.
 *
 * Post-v0.10.0 — POST creates a MANUALLY-provisioned client for MCP clients
 * that can't reach (or don't support) dynamic registration. Answers 201 with
 * `{ client, clientSecret }`; `clientSecret` is the ONE-TIME plaintext
 * (confidential clients only, null for public PKCE clients) — the response
 * body is its only carrier; it is never persisted, logged, or audited.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import {
  createManualClient,
  listRegisteredClients,
  MANUAL_CLIENT_MAX_REDIRECT_URIS,
  MANUAL_CLIENT_NAME_MAX,
} from '@/lib/oauth/admin-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  clientName: z.string().min(1).max(MANUAL_CLIENT_NAME_MAX),
  redirectUris: z.array(z.string().min(1)).min(1).max(MANUAL_CLIENT_MAX_REDIRECT_URIS),
  confidential: z.boolean(),
});

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const clients = await listRegisteredClients(getDb());
    return NextResponse.json({ clients });
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
    const auth = await requireRole('admin');

    const json = await req.json().catch(() => null);
    const parsed = CreateBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const db = getDb();
    const result = await createManualClient(db, {
      clientName: parsed.data.clientName,
      redirectUris: parsed.data.redirectUris,
      confidential: parsed.data.confidential,
      createdBy: auth.userId,
    });
    // Semantic validation (redirect-URI shape etc.) lives in the lib — zod
    // only pins the body shape. A typed validation result maps to a 400.
    if ('kind' in result) {
      return NextResponse.json({ error: result.description }, { status: 400 });
    }

    await recordAudit(db, {
      workspaceId: auth.workspaceId,
      actorUserId: auth.userId,
      action: 'oauth.client_created_manual',
      targetType: 'oauth_client',
      targetId: result.row.id,
      // ids + flags only — NEVER the plaintext secret (assertAuditMetadataClean
      // would throw on the cairn_ocs_ prefix anyway).
      metadata: {
        clientId: result.row.clientId,
        name: result.row.clientName,
        confidential: result.row.clientSecretHash !== null,
      },
    });

    // The response body is the ONLY carrier of the plaintext secret.
    return NextResponse.json(
      {
        client: {
          id: result.row.id,
          clientId: result.row.clientId,
          name: result.row.clientName,
          redirectUris: result.row.redirectUris,
          confidential: result.row.clientSecretHash !== null,
          createdAt: result.row.createdAt.toISOString(),
        },
        clientSecret: result.clientSecret,
      },
      { status: 201 },
    );
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
