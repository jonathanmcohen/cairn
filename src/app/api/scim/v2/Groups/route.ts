import { eq } from 'drizzle-orm';
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

function originFor(req: Request): string {
  return process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
}

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  let token;
  try {
    token = await requireScimBearer(req, db);
  } catch (err) {
    if (err instanceof ScimAuthError) return scimError(err.message, 401);
    console.error('[scim] GET /Groups auth error', err);
    return scimError('unauthorized', 401);
  }
  try {
    requireScope(token, 'groups:read');
  } catch (err) {
    return scimError(err instanceof Error ? err.message : 'forbidden', 403);
  }

  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, token.workspaceId));

  const grouped = new Map<Role, Array<{ id: string; email: string }>>();
  for (const role of ROLES) grouped.set(role, []);
  for (const r of rows) {
    if ((ROLES as readonly string[]).includes(r.role)) {
      grouped.get(r.role as Role)!.push({ id: r.userId, email: r.email });
    }
  }

  const origin = originFor(req);
  const body = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: ROLES.length,
    itemsPerPage: ROLES.length,
    startIndex: 1,
    Resources: ROLES.map((role) =>
      serializeGroupForScim({ role, members: grouped.get(role) ?? [], origin }),
    ),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/scim+json' },
  });
}

export async function POST(_req: Request): Promise<Response> {
  return scimError(
    'groups are a fixed role enum in v0.9.0; arbitrary group creation deferred to v1.0',
    403,
  );
}
