import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey } from '@/lib/api/keys';
import { mintPat } from '@/lib/auth/pat';
import { HttpError } from '@/lib/auth/require-role';
import { requireScope, resolveToken } from '@/lib/auth/token';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// resolveToken reads the live db via getDb(); pin the test container.
vi.mock('@/db/client', () => ({
  getDb: () => db,
}));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE personal_access_tokens, api_keys, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('resolveToken — header parsing', () => {
  it('returns null when header is missing', async () => {
    expect(await resolveToken(null)).toBeNull();
    expect(await resolveToken(undefined)).toBeNull();
  });

  it('returns null when header is not "Bearer <secret>"', async () => {
    expect(await resolveToken('cairn_pat_xxx')).toBeNull(); // no Bearer prefix
    expect(await resolveToken('Basic abcdef')).toBeNull();
    expect(await resolveToken('Bearer')).toBeNull();
  });

  it('returns null when token does not start with a known prefix', async () => {
    expect(await resolveToken('Bearer some-random-string')).toBeNull();
    expect(await resolveToken('Bearer cairn_unknown_xxx')).toBeNull();
  });
});

describe('resolveToken — prefix dispatch', () => {
  it('dispatches cairn_sk_ tokens to the api_keys path', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'sk',
      role: 'editor',
      createdBy: u.userId,
    });
    const ctx = await resolveToken(`Bearer ${token}`);
    expect(ctx).not.toBeNull();
    expect(ctx?.kind).toBe('api_key');
    expect(ctx?.workspaceId).toBe(u.workspaceId);
    // api_key tokens carry the v0.5 role-derived scope superset; assert at least
    // the role-equivalent read+write scopes are present.
    expect(ctx?.scopes).toContain('pages:read');
    expect(ctx?.mcpTools).toEqual([]); // api_keys never carry an MCP allowlist
  });

  it('dispatches cairn_pat_ tokens to the PAT path', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'pat',
      scopes: ['pages:read', 'mcp:read'],
      mcpTools: ['pages.read'],
      expiresAt: null,
    });
    const ctx = await resolveToken(`Bearer ${token}`);
    expect(ctx).not.toBeNull();
    expect(ctx?.kind).toBe('pat');
    expect(ctx?.userId).toBe(u.userId);
    expect(ctx?.workspaceId).toBe(u.workspaceId);
    expect(ctx?.scopes).toEqual(['pages:read', 'mcp:read']);
    expect(ctx?.mcpTools).toEqual(['pages.read']);
  });
});

describe('requireScope', () => {
  it('returns silently when the scope is present', () => {
    expect(() =>
      requireScope(
        {
          kind: 'pat',
          tokenId: 't',
          userId: 'u',
          workspaceId: 'w',
          scopes: ['pages:read'],
          mcpTools: [],
        },
        'pages:read',
      ),
    ).not.toThrow();
  });

  it('throws HttpError(403) when the scope is missing', () => {
    let caught: unknown = null;
    try {
      requireScope(
        {
          kind: 'pat',
          tokenId: 't',
          userId: 'u',
          workspaceId: 'w',
          scopes: ['pages:read'],
          mcpTools: [],
        },
        'pages:write',
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(403);
  });

  it('the admin scope acts as a superset (bypasses per-resource checks)', () => {
    expect(() =>
      requireScope(
        {
          kind: 'pat',
          tokenId: 't',
          userId: 'u',
          workspaceId: 'w',
          scopes: ['admin'],
          mcpTools: [],
        },
        'pages:destructive',
      ),
    ).not.toThrow();
  });
});
