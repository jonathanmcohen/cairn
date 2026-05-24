import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { applyTemplate, BadConfigError } from '@/lib/automation/actions';
import { runCreatePage } from '@/lib/automation/actions/create-page';
import { startPostgres, stopPostgres } from '../../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let userId: string;
let templateId: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE templates, pages, databases, db_properties, db_views, db_rows, db_cells, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('workspace insert failed');
  workspaceId = w.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role: 'owner' });
  const [t] = await db
    .insert(schema.templates)
    .values({
      workspaceId,
      name: 'Tpl',
      kind: 'page',
      payload: {
        kind: 'page',
        rootPageId: '00000000-0000-0000-0000-000000000001',
        pages: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            parentId: null,
            title: 'Template title',
            icon: null,
            content: { type: 'doc', content: [] },
          },
        ],
        databases: [],
      },
    })
    .returning();
  if (!t) throw new Error('template insert failed');
  templateId = t.id;
});

describe('applyTemplate', () => {
  it('substitutes dotted-path expressions', () => {
    expect(applyTemplate('Hi {{trigger.row.title}}', { trigger: { row: { title: 'Bob' } } })).toBe(
      'Hi Bob',
    );
  });

  it('emits empty string on missing path', () => {
    expect(applyTemplate('A={{x.y}}!', {})).toBe('A=!');
  });

  it('json-stringifies non-string scalar values', () => {
    expect(applyTemplate('n={{n}}', { n: 7 })).toBe('n=7');
  });
});

describe('runCreatePage', () => {
  it('instantiates the template and rewrites the root title via titleTemplate', async () => {
    await runCreatePage(
      { templateId, titleTemplate: 'New: {{trigger.row.title}}' },
      { trigger: { row: { title: 'Apples' } } },
      { ruleId: 'r', workspaceId, createdBy: userId },
    );
    const pages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, workspaceId));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.some((p) => p.title === 'New: Apples')).toBe(true);
  });

  it('leaves the template title intact when no titleTemplate is provided', async () => {
    await runCreatePage(
      { templateId },
      { trigger: { row: { title: 'Apples' } } },
      { ruleId: 'r', workspaceId, createdBy: userId },
    );
    const pages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, workspaceId));
    expect(pages.some((p) => p.title === 'Template title')).toBe(true);
  });

  it('falls back to workspace owner when ctx.createdBy is null', async () => {
    await runCreatePage({ templateId }, {}, { ruleId: 'r', workspaceId, createdBy: null });
    const pages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, workspaceId));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.createdBy).toBe(userId);
  });

  it('throws BadConfigError on missing templateId', async () => {
    await expect(
      runCreatePage({}, {}, { ruleId: 'r', workspaceId, createdBy: userId }),
    ).rejects.toThrow(BadConfigError);
  });

  it('throws when the template id does not exist', async () => {
    await expect(
      runCreatePage(
        { templateId: '00000000-0000-0000-0000-deadbeefdead' },
        {},
        { ruleId: 'r', workspaceId, createdBy: userId },
      ),
    ).rejects.toThrow();
  });
});
