import { and, sql as drizzleSql, eq, gt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import {
  type ParsedScimFilter,
  parseScimFilter,
  requireScimBearer,
  requireScope,
  ScimAuthError,
  ScimFilterError,
  scimError,
  serializeUserForScim,
} from '@/lib/sso/scim';
import type { VerifiedScimToken } from '@/lib/sso/scim-token';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().min(1),
  displayName: z.string().optional(),
  emails: z.array(z.object({ value: z.email(), primary: z.boolean().optional() })).optional(),
  active: z.boolean().optional(),
  groups: z.array(z.object({ value: z.string() })).optional(),
});

const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;

function originFor(req: Request): string {
  return process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
}

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  let token: VerifiedScimToken;
  try {
    token = await requireScimBearer(req, db);
  } catch (err) {
    if (err instanceof ScimAuthError) return scimError(err.message, 401);
    console.error('[scim] GET /Users auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'users:read');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }

  const url = new URL(req.url);
  let filter: ParsedScimFilter | null;
  try {
    filter = parseScimFilter(url.searchParams.get('filter'));
  } catch (err) {
    if (err instanceof ScimFilterError) return scimError(err.message, 400, 'invalidFilter');
    console.error('[scim] GET /Users filter error', err);
    return scimError('invalid filter', 400, 'invalidFilter');
  }
  const count = Math.min(Number(url.searchParams.get('count') ?? '100'), 200);
  const startIndex = Math.max(1, Number(url.searchParams.get('startIndex') ?? '1'));

  // Build the WHERE clause. The base predicate is the workspace scope; we
  // tack on filter predicates via and() so cross-workspace rows are never
  // visible even if a token is leaked.
  let where: SQL = eq(schema.workspaceMembers.workspaceId, token.workspaceId);
  if (filter?.kind === 'userName-eq') {
    where = and(where, eq(schema.users.email, filter.value)) as SQL;
  } else if (filter?.kind === 'lastModified-gt') {
    where = and(where, gt(schema.users.createdAt, filter.value)) as SQL;
  }

  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.workspaceMembers.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(where)
    .limit(count)
    .offset(startIndex - 1);

  const totalQuery = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(where);
  const total = totalQuery[0]?.count ?? 0;

  const origin = originFor(req);
  const body = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: total,
    itemsPerPage: rows.length,
    startIndex,
    Resources: rows.map((r) =>
      serializeUserForScim({
        user: { id: r.userId, email: r.email, name: r.name ?? r.email },
        role: r.role,
        active: true,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        origin,
      }),
    ),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/scim+json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  let token: VerifiedScimToken;
  try {
    token = await requireScimBearer(req, db);
  } catch (err) {
    if (err instanceof ScimAuthError) return scimError(err.message, 401);
    console.error('[scim] POST /Users auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'users:write');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }

  const json = await req.json().catch((err: unknown) => {
    console.error('[scim] POST /Users body parse error', err);
    return null;
  });
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) return scimError('invalid body', 400);

  const email = parsed.data.emails?.[0]?.value ?? parsed.data.userName;
  const name = parsed.data.displayName ?? email;
  const requestedRole = parsed.data.groups?.[0]?.value;
  const role: schema.MemberRole =
    requestedRole && (ROLES as readonly string[]).includes(requestedRole)
      ? (requestedRole as schema.MemberRole)
      : 'editor';

  try {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      let userId: string;
      let isCreate = false;
      if (existing) {
        userId = existing.id;
      } else {
        const [created] = await tx
          .insert(schema.users)
          .values({ email, name, passwordHash: 'scim:no-password' })
          .returning({ id: schema.users.id });
        userId = created!.id;
        isCreate = true;
      }

      // Idempotent membership upsert keyed on (workspaceId, userId)
      // primary key. If the row exists we leave it alone (preserve role).
      await tx
        .insert(schema.workspaceMembers)
        .values({ workspaceId: token.workspaceId, userId, role })
        .onConflictDoNothing({
          target: [schema.workspaceMembers.workspaceId, schema.workspaceMembers.userId],
        });

      const [reloaded] = await tx
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
            eq(schema.workspaceMembers.workspaceId, token.workspaceId),
            eq(schema.workspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      return { reloaded, isCreate };
    });

    const reloaded = result.reloaded;
    if (!reloaded) return scimError('failed to create', 500);
    const body = serializeUserForScim({
      user: {
        id: reloaded.userId,
        email: reloaded.email,
        name: reloaded.name ?? reloaded.email,
      },
      role: reloaded.role,
      active: true,
      createdAt: reloaded.createdAt,
      updatedAt: reloaded.createdAt,
      origin: originFor(req),
    });
    return new Response(JSON.stringify(body), {
      status: result.isCreate ? 201 : 200,
      headers: { 'content-type': 'application/scim+json' },
    });
  } catch (err) {
    console.error('[scim] POST /Users transaction failed', err);
    return scimError('failed to create user', 500);
  }
}
