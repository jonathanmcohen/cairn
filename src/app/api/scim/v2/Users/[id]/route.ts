import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import {
  requireScimBearer,
  requireScope,
  ScimAuthError,
  scimError,
  serializeUserForScim,
} from '@/lib/sso/scim';

export const dynamic = 'force-dynamic';

const PatchOp = z.object({
  op: z
    .enum(['add', 'replace', 'remove', 'Add', 'Replace', 'Remove'])
    .transform((o) => o.toLowerCase() as 'add' | 'replace' | 'remove'),
  path: z.string().optional(),
  value: z.unknown().optional(),
});
const PatchBody = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(PatchOp).min(1),
});

const ROLES = ['admin', 'editor', 'viewer'] as const;

function originFor(req: Request): string {
  return process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
}

async function loadOwnedUser(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  userId: string,
): Promise<{
  userId: string;
  email: string;
  name: string;
  role: schema.MemberRole;
  createdAt: Date;
} | null> {
  const [row] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.workspaceMembers.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  let token;
  try {
    token = await requireScimBearer(req, db);
  } catch (err) {
    if (err instanceof ScimAuthError) return scimError(err.message, 401);
    console.error('[scim] GET /Users/[id] auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'users:read');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }
  const { id } = await ctx.params;
  const row = await loadOwnedUser(db, token.workspaceId, id);
  if (!row) return scimError('not found', 404);
  return new Response(
    JSON.stringify(
      serializeUserForScim({
        user: { id: row.userId, email: row.email, name: row.name ?? row.email },
        role: row.role,
        active: true,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        origin: originFor(req),
      }),
    ),
    { status: 200, headers: { 'content-type': 'application/scim+json' } },
  );
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  let token;
  try {
    token = await requireScimBearer(req, db);
  } catch (err) {
    if (err instanceof ScimAuthError) return scimError(err.message, 401);
    console.error('[scim] PATCH /Users/[id] auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'users:write');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }

  const { id } = await ctx.params;
  const existing = await loadOwnedUser(db, token.workspaceId, id);
  if (!existing) return scimError('not found', 404);

  const json = await req.json().catch((err: unknown) => {
    console.error('[scim] PATCH /Users/[id] body parse error', err);
    return null;
  });
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return scimError('invalid body', 400);

  const userUpdates: { name?: string; email?: string } = {};
  let membershipDelete = false;
  let roleChange: schema.MemberRole | null = null;

  for (const op of parsed.data.Operations) {
    const path = (op.path ?? '').trim();
    const value = op.value as unknown;
    if (path === 'displayName' && (op.op === 'replace' || op.op === 'add')) {
      if (typeof value === 'string') userUpdates.name = value;
      continue;
    }
    if (path === 'userName' && (op.op === 'replace' || op.op === 'add')) {
      if (typeof value === 'string') userUpdates.email = value;
      continue;
    }
    if (path === 'active' && (op.op === 'replace' || op.op === 'add')) {
      if (value === false) membershipDelete = true;
      continue;
    }
    if (
      (path === 'groups' || path.startsWith('groups')) &&
      (op.op === 'replace' || op.op === 'add')
    ) {
      // accept { value: 'admin' | 'editor' | 'viewer' } or array thereof
      const v = Array.isArray(value) ? value[0] : value;
      const role =
        typeof v === 'string'
          ? v
          : typeof v === 'object' &&
              v !== null &&
              typeof (v as { value?: unknown }).value === 'string'
            ? (v as { value: string }).value
            : null;
      if (role && (ROLES as readonly string[]).includes(role)) {
        roleChange = role as schema.MemberRole;
      }
    }
    // Unsupported op path: ignore (per SCIM spec PATCH is best-effort for
    // unknown paths if the server doesn't choose to error).
  }

  try {
    await db.transaction(async (tx) => {
      if (Object.keys(userUpdates).length > 0) {
        await tx.update(schema.users).set(userUpdates).where(eq(schema.users.id, id));
      }
      if (roleChange) {
        await tx
          .update(schema.workspaceMembers)
          .set({ role: roleChange })
          .where(
            and(
              eq(schema.workspaceMembers.workspaceId, token.workspaceId),
              eq(schema.workspaceMembers.userId, id),
            ),
          );
      }
      if (membershipDelete) {
        await tx
          .delete(schema.workspaceMembers)
          .where(
            and(
              eq(schema.workspaceMembers.workspaceId, token.workspaceId),
              eq(schema.workspaceMembers.userId, id),
            ),
          );
      }
    });
  } catch (err) {
    console.error('[scim] PATCH /Users/[id] transaction failed', err);
    return scimError('update failed', 500);
  }

  if (membershipDelete) {
    return new Response(null, { status: 204 });
  }

  const reloaded = await loadOwnedUser(db, token.workspaceId, id);
  if (!reloaded) return scimError('not found', 404);
  return new Response(
    JSON.stringify(
      serializeUserForScim({
        user: { id: reloaded.userId, email: reloaded.email, name: reloaded.name ?? reloaded.email },
        role: reloaded.role,
        active: true,
        createdAt: reloaded.createdAt,
        updatedAt: reloaded.createdAt,
        origin: originFor(req),
      }),
    ),
    { status: 200, headers: { 'content-type': 'application/scim+json' } },
  );
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  let token;
  try {
    token = await requireScimBearer(req, db);
  } catch (err) {
    if (err instanceof ScimAuthError) return scimError(err.message, 401);
    console.error('[scim] DELETE /Users/[id] auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'users:write');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }

  const { id } = await ctx.params;
  const existing = await loadOwnedUser(db, token.workspaceId, id);
  if (!existing) return scimError('not found', 404);

  await db
    .delete(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, token.workspaceId),
        eq(schema.workspaceMembers.userId, id),
      ),
    );
  return new Response(null, { status: 204 });
}
