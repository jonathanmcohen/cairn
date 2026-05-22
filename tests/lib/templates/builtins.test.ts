import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { seedBuiltinTemplates } from '@/lib/templates/builtins';
import { startPostgres, stopPostgres } from '../../helpers/db';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
beforeEach(async () => {
  await getDb().execute(sql`TRUNCATE templates RESTART IDENTITY CASCADE`);
});

describe('seedBuiltinTemplates', () => {
  it('seeds global built-ins and is idempotent', async () => {
    await seedBuiltinTemplates(getDb());
    const first = await getDb()
      .select()
      .from(schema.templates)
      .where(and(eq(schema.templates.builtIn, true), isNull(schema.templates.workspaceId)));
    expect(first.length).toBeGreaterThanOrEqual(3);

    await seedBuiltinTemplates(getDb()); // run again
    const second = await getDb()
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.builtIn, true));
    expect(second).toHaveLength(first.length); // no duplicates
    // every built-in payload validates
    for (const t of second) expect(['page', 'database']).toContain(t.kind);
  });
});
