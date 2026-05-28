import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { type VerifiedScimToken, verifyScimToken } from './scim-token';

type Db = PostgresJsDatabase<typeof schema>;

export class ScimFilterError extends Error {
  readonly scimType = 'invalidFilter';
  constructor(message: string) {
    super(message);
    this.name = 'ScimFilterError';
  }
}

export class ScimAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScimAuthError';
  }
}

export type ParsedScimFilter =
  | { kind: 'userName-eq'; value: string }
  | { kind: 'lastModified-gt'; value: Date };

/**
 * Parse the supported subset of SCIM 2.0 filter syntax:
 *   - userName eq "value"
 *   - meta.lastModified gt "ISO-8601"
 *
 * Returns null for the no-filter case. Throws ScimFilterError for anything
 * else (the caller turns the throw into a SCIM `400 invalidFilter`).
 */
export function parseScimFilter(rawFilter: string | undefined | null): ParsedScimFilter | null {
  if (rawFilter === undefined || rawFilter === null || rawFilter.trim() === '') return null;
  const f = rawFilter.trim();

  // Refuse logical combinators and parens up front.
  if (/\s+(and|or)\s+/i.test(f)) {
    throw new ScimFilterError('logical combinators not supported');
  }
  if (f.startsWith('(') || f.endsWith(')')) {
    throw new ScimFilterError('grouping parens not supported');
  }

  // userName eq "value" | 'value'
  const userMatch = f.match(/^userName\s+eq\s+["']([^"']*)["']$/);
  if (userMatch) {
    return { kind: 'userName-eq', value: userMatch[1] ?? '' };
  }
  // meta.lastModified gt "ISO"
  const metaMatch = f.match(/^meta\.lastModified\s+gt\s+["']([^"']*)["']$/);
  if (metaMatch) {
    const d = new Date(metaMatch[1] ?? '');
    if (Number.isNaN(d.getTime())) {
      throw new ScimFilterError('invalid datetime literal');
    }
    return { kind: 'lastModified-gt', value: d };
  }

  // Reject specific common-but-unsupported forms with a clearer message.
  if (/^userName\s+(ne|co|sw|ew|gt|lt|le|ge)/i.test(f)) {
    throw new ScimFilterError('only userName eq is supported');
  }
  if (/^meta\.lastModified\s+(eq|lt|le|ge)/i.test(f)) {
    throw new ScimFilterError('only meta.lastModified gt is supported');
  }
  throw new ScimFilterError('unsupported filter syntax');
}

export async function requireScimBearer(req: Request, db: Db): Promise<VerifiedScimToken> {
  const auth = req.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new ScimAuthError('missing bearer token');
  const verified = await verifyScimToken(db, match[1] ?? '');
  if (!verified) throw new ScimAuthError('invalid token');
  return verified;
}

export function requireScope(verified: VerifiedScimToken, scope: string): void {
  if (!verified.scopes.includes(scope)) {
    throw new ScimAuthError(`token missing scope: ${scope}`);
  }
}

/** SCIM v2 User resource shape. */
export type ScimUser = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'];
  id: string;
  userName: string;
  displayName: string;
  emails: Array<{ value: string; primary: boolean }>;
  active: boolean;
  meta: { resourceType: 'User'; created: string; lastModified: string; location: string };
  groups?: Array<{ value: string; display: string }>;
};

export function serializeUserForScim(input: {
  user: { id: string; email: string; name: string };
  role: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  origin: string;
}): ScimUser {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: input.user.id,
    userName: input.user.email,
    displayName: input.user.name,
    emails: [{ value: input.user.email, primary: true }],
    active: input.active,
    meta: {
      resourceType: 'User',
      created: input.createdAt.toISOString(),
      lastModified: input.updatedAt.toISOString(),
      location: `${input.origin.replace(/\/$/, '')}/api/scim/v2/Users/${input.user.id}`,
    },
    groups: [{ value: input.role, display: input.role }],
  };
}

export type ScimGroup = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'];
  id: string;
  displayName: string;
  members: Array<{ value: string; display: string; type: 'User' }>;
  meta: { resourceType: 'Group'; location: string };
};

export function serializeGroupForScim(input: {
  role: string;
  members: Array<{ id: string; email: string }>;
  origin: string;
}): ScimGroup {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: input.role,
    displayName: input.role,
    members: input.members.map((m) => ({ value: m.id, display: m.email, type: 'User' as const })),
    meta: {
      resourceType: 'Group',
      location: `${input.origin.replace(/\/$/, '')}/api/scim/v2/Groups/${input.role}`,
    },
  };
}

export function scimError(detail: string, status: number, scimType?: string): Response {
  const body: Record<string, unknown> = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail,
    status: String(status),
  };
  if (scimType) body.scimType = scimType;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/scim+json' },
  });
}
