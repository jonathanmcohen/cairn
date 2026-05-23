import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri); // must apply 0021 cleanly on a fresh DB
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg.end();
  await stopPostgres();
});

function uniqueSlug(prefix = 'ws'): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

async function columns(
  table: string,
): Promise<Record<string, { type: string; nullable: boolean; default: string | null }>> {
  const rows = (await db.execute(
    sql`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = ${table}`,
  )) as unknown as {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }[];
  return Object.fromEntries(
    rows.map((r) => [
      r.column_name,
      { type: r.data_type, nullable: r.is_nullable === 'YES', default: r.column_default },
    ]),
  );
}

describe('migration 0021', () => {
  it('adds workspaces.require_2fa (bool not null default false) and home_page_id (uuid null)', async () => {
    const cols = await columns('workspaces');
    expect(cols.require_2fa).toBeDefined();
    expect(cols.require_2fa?.type).toBe('boolean');
    expect(cols.require_2fa?.nullable).toBe(false);
    expect(cols.require_2fa?.default).toMatch(/false/);
    expect(cols.home_page_id).toBeDefined();
    expect(cols.home_page_id?.type).toBe('uuid');
    expect(cols.home_page_id?.nullable).toBe(true);
  });

  it('creates audit_log with the documented shape', async () => {
    const cols = await columns('audit_log');
    expect(cols.id).toBeDefined();
    expect(cols.workspace_id?.type).toBe('uuid');
    expect(cols.workspace_id?.nullable).toBe(false);
    expect(cols.actor_user_id?.nullable).toBe(true); // nullable for system/cron actors
    expect(cols.action?.type).toBe('text');
    expect(cols.action?.nullable).toBe(false);
    expect(cols.target_type?.nullable).toBe(true);
    expect(cols.target_id?.nullable).toBe(true);
    expect(cols.metadata?.type).toBe('jsonb');
    expect(cols.metadata?.nullable).toBe(false);
    expect(cols.ip?.nullable).toBe(true);
    expect(cols.created_at?.nullable).toBe(false);
  });

  it('creates user_totp with user_id PK + encrypted secret + recovery codes', async () => {
    const cols = await columns('user_totp');
    expect(cols.user_id?.type).toBe('uuid');
    expect(cols.user_id?.nullable).toBe(false);
    expect(cols.secret_encrypted?.type).toBe('bytea');
    expect(cols.secret_encrypted?.nullable).toBe(false);
    expect(cols.recovery_codes?.type).toBe('jsonb');
    expect(cols.enabled_at?.nullable).toBe(true);
    expect(cols.last_used_at?.nullable).toBe(true);
  });

  it('home_page_id references pages(id) on delete set null', async () => {
    // Delete a page that is a workspace home; the FK should null the column, not error.
    const [u] = await db
      .insert(schema.users)
      .values({
        email: `h-${randomBytes(6).toString('hex')}@x.com`,
        passwordHash: 'h',
        name: 'H',
      })
      .returning();
    if (!u) throw new Error('user insert failed');
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'WS', slug: uniqueSlug() })
      .returning();
    if (!ws) throw new Error('workspace insert failed');
    const [pg2] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.id,
        title: 'Home',
        content: { type: 'doc', content: [] },
        createdBy: u.id,
      })
      .returning();
    if (!pg2) throw new Error('page insert failed');
    await db.update(schema.workspaces).set({ homePageId: pg2.id }).where(sql`id = ${ws.id}`);
    await db.delete(schema.pages).where(sql`id = ${pg2.id}`);
    const [after] = await db.select().from(schema.workspaces).where(sql`id = ${ws.id}`);
    expect(after?.homePageId).toBeNull();
  });
});
