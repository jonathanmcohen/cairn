import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { listVisibleTemplates } from '@/lib/templates/access';
import { seedBuiltinTemplates } from '@/lib/templates/builtins';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
beforeEach(async () => {
  await getDb().execute(
    sql`TRUNCATE templates, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`,
  );
});

describe('built-in templates listing', () => {
  it('lists seeded built-ins for a fresh workspace/user', async () => {
    await seedBuiltinTemplates(getDb());
    const { userId, workspaceId } = await createTestWorkspaceWithUser(getDb());

    const rows = await listVisibleTemplates(getDb(), {
      viewerUserId: userId,
      viewerWorkspaceId: workspaceId,
    });
    const names = rows.map((r) => r.name);

    expect(names).toContain('Welcome to Cairn');
    expect(names).toContain('Meeting notes');
    expect(names).toContain('Weekly planner');
    expect(names).toContain('Project tracker');
    // All four built-ins surface as built-in rows.
    const builtins = rows.filter((r) => r.builtIn);
    expect(builtins).toHaveLength(4);
  });
});
