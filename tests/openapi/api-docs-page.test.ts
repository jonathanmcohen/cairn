import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
  redirects.length = 0;
});

let active: { name: string; value: string } | undefined;
const redirects: string[] = [];

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => active, set: () => {} }),
}));
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    redirects.push(target);
    throw new Error(`__redirect:${target}`);
  },
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}
async function user(name: string) {
  const [u] = await getDb()
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function ws() {
  const [w] = await getDb()
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}
async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

describe('GET /api-docs (RSC)', () => {
  it('unauthenticated → redirect to /signin with callbackUrl', async () => {
    const { default: Page } = await import('@/app/api-docs/page');
    await setUser(null);
    await expect(Page()).rejects.toThrow(/__redirect:/);
    expect(redirects[0]).toContain('/signin');
    expect(redirects[0]).toContain('callbackUrl=/api-docs');
  });

  it('authenticated but no workspace → redirect to /', async () => {
    const { default: Page } = await import('@/app/api-docs/page');
    const uid = await user('lonely');
    await setUser({ userId: uid });
    await expect(Page()).rejects.toThrow(/__redirect:/);
    expect(redirects[0]).toBe('/');
  });

  it('workspace member → renders the Swagger UI shell', async () => {
    const { default: Page } = await import('@/app/api-docs/page');
    const w = await ws();
    const uid = await user('member');
    await addMember(w, uid, 'viewer');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: uid });
    const el = await Page();
    expect(el).toBeTruthy();
    // The <main> element carries the a11y label.
    const main = el as { props: { 'aria-label': string } };
    expect(main.props['aria-label']).toBe('API documentation');
  });
});
