import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  addRowTemplate,
  applyRowTemplate,
  listRowTemplates,
  type RowTemplate,
  removeRowTemplate,
} from '@/lib/databases/row-templates';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pages, databases, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeDatabase(workspaceId: string, userId: string) {
  const page = await createPage(db, { workspaceId, createdBy: userId });
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, name: 'D', createdBy: userId })
    .returning();
  if (!d) throw new Error('database insert failed');
  return d;
}

const tpl: Omit<RowTemplate, 'id'> = {
  name: 'Bug report',
  cellDefaults: { 'prop-1': 'Open', 'prop-2': 3 },
  contentTemplate: { type: 'doc', content: [] },
};

describe('row templates', () => {
  it('add/list/remove operate on the config object', () => {
    let config: Record<string, unknown> = {};
    config = addRowTemplate(config, tpl);
    let list = listRowTemplates(config);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Bug report');
    expect(list[0]?.id).toBeTruthy();

    const id = list[0]?.id ?? '';
    config = removeRowTemplate(config, id);
    list = listRowTemplates(config);
    expect(list).toHaveLength(0);
  });

  it('persists templates in databases.config jsonb', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);

    const config = addRowTemplate((d.config as Record<string, unknown>) ?? {}, tpl);
    await db.update(schema.databases).set({ config }).where(eq(schema.databases.id, d.id));

    const [reloaded] = await db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.id, d.id));
    if (!reloaded) throw new Error('reload failed');
    const list = listRowTemplates(reloaded.config as Record<string, unknown>);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Bug report');
    expect(list[0]?.cellDefaults).toEqual({ 'prop-1': 'Open', 'prop-2': 3 });
  });

  it('applyRowTemplate returns cell + content seed', () => {
    const full: RowTemplate = { id: 'x', ...tpl };
    const seed = applyRowTemplate(full);
    expect(seed.cells).toEqual({ 'prop-1': 'Open', 'prop-2': 3 });
    expect(seed.content).toEqual({ type: 'doc', content: [] });
  });

  it('a bare template yields empty cells and undefined content', () => {
    const bare: RowTemplate = { id: 'y', name: 'Empty', cellDefaults: {} };
    const seed = applyRowTemplate(bare);
    expect(seed.cells).toEqual({});
    expect(seed.content).toBeUndefined();
  });
});
