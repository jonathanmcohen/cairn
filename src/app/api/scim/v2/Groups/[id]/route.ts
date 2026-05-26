import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import {
  requireScimBearer,
  requireScope,
  ScimAuthError,
  scimError,
  serializeGroupForScim,
} from '@/lib/sso/scim';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'editor', 'viewer'] as const;
type Role = (typeof ROLES)[number];

const PatchBody = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.object({
        op: z
          .enum(['add', 'remove', 'replace', 'Add', 'Remove', 'Replace'])
          .transform((o) => o.toLowerCase() as 'add' | 'remove' | 'replace'),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});

function originFor(req: Request): string {
  return process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
}

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
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
    console.error('[scim] GET /Groups/[id] auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'groups:read');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }
  const { id } = await ctx.params;
  if (!isRole(id)) return scimError('not found', 404);

  const rows = await db
    .select({ userId: schema.users.id, email: schema.users.email })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, token.workspaceId),
        eq(schema.workspaceMembers.role, id),
      ),
    );

  return new Response(
    JSON.stringify(
      serializeGroupForScim({
        role: id,
        members: rows.map((r) => ({ id: r.userId, email: r.email })),
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
    console.error('[scim] PATCH /Groups/[id] auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'groups:write');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }

  const { id } = await ctx.params;
  if (!isRole(id)) return scimError('not found', 404);

  const json = await req.json().catch((err: unknown) => {
    console.error('[scim] PATCH /Groups/[id] body parse error', err);
    return null;
  });
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return scimError('invalid body', 400);

  try {
    await db.transaction(async (tx) => {
      for (const op of parsed.data.Operations) {
        const path = (op.path ?? '').trim();
        if (path !== 'members') continue;
        const valueArr = Array.isArray(op.value) ? op.value : [op.value];
        for (const v of valueArr) {
          const userId =
            typeof v === 'string'
              ? v
              : typeof v === 'object' &&
                  v !== null &&
                  typeof (v as { value?: unknown }).value === 'string'
                ? (v as { value: string }).value
                : null;
          if (!userId) continue;
          if (op.op === 'add' || op.op === 'replace') {
            // Move-into-role: upsert membership at this role.
            const [existing] = await tx
              .select()
              .from(schema.workspaceMembers)
              .where(
                and(
                  eq(schema.workspaceMembers.workspaceId, token.workspaceId),
                  eq(schema.workspaceMembers.userId, userId),
                ),
              )
              .limit(1);
            if (existing) {
              await tx
                .update(schema.workspaceMembers)
                .set({ role: id })
                .where(
                  and(
                    eq(schema.workspaceMembers.workspaceId, token.workspaceId),
                    eq(schema.workspaceMembers.userId, userId),
                  ),
                );
            } else {
              await tx
                .insert(schema.workspaceMembers)
                .values({ workspaceId: token.workspaceId, userId, role: id });
            }
          } else if (op.op === 'remove') {
            // Remove from THIS role only — i.e. delete membership if currently at this role.
            await tx
              .delete(schema.workspaceMembers)
              .where(
                and(
                  eq(schema.workspaceMembers.workspaceId, token.workspaceId),
                  eq(schema.workspaceMembers.userId, userId),
                  eq(schema.workspaceMembers.role, id),
                ),
              );
          }
        }
      }
    });
  } catch (err) {
    console.error('[scim] PATCH /Groups/[id] transaction failed', err);
    return scimError('update failed', 500);
  }

  const rows = await db
    .select({ userId: schema.users.id, email: schema.users.email })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, token.workspaceId),
        eq(schema.workspaceMembers.role, id),
      ),
    );

  return new Response(
    JSON.stringify(
      serializeGroupForScim({
        role: id,
        members: rows.map((r) => ({ id: r.userId, email: r.email })),
        origin: originFor(req),
      }),
    ),
    { status: 200, headers: { 'content-type': 'application/scim+json' } },
  );
}

export async function DELETE(
  _req: Request,
  _ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return scimError('groups are a fixed role enum in v0.9.0; deletion is not supported', 403);
}
