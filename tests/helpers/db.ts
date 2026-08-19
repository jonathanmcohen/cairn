import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@/db/schema';

let container: StartedPostgreSqlContainer | null = null;

export async function startPostgres(): Promise<string> {
  if (container) {
    if (!testSql) {
      testSql = postgres(container.getConnectionUri());
      testDb = drizzle(testSql, { schema });
      await migrate(testDb, { migrationsFolder: './drizzle/migrations' });
    }
    return container.getConnectionUri();
  }
  // ghcr.io/jonathanmcohen/pgvector:18-0.8.6 - Postgres 18 +
  // pgvector. Built and published by github.com/jonathanmcohen/pgvector.
  // Same ref across CI services,
  // Testcontainers, and docker-compose.
  container = await new PostgreSqlContainer('ghcr.io/jonathanmcohen/pgvector:18-0.8.6')
    .withDatabase('cairn_test')
    .withUsername('cairn')
    .withPassword('cairn')
    .start();
  const uri = container.getConnectionUri();
  testSql = postgres(uri);
  testDb = drizzle(testSql, { schema });
  await migrate(testDb, { migrationsFolder: './drizzle/migrations' });
  return uri;
}

export async function stopPostgres(): Promise<void> {
  if (testSql) {
    await testSql.end();
    testSql = null;
    testDb = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
}

// v0.9.8 G6 — shared migrated test db + TRUNCATE reset, so the chat-oauth
// schema/callback suites can use a single `migrate()`-applied handle (mirrors
// the inline pattern in tests/db/schema.test.ts).
let testSql: ReturnType<typeof postgres> | null = null;
let testDb: PostgresJsDatabase<typeof schema> | null = null;

export function getTestDb(): PostgresJsDatabase<typeof schema> {
  if (!testDb) {
    throw new Error('getTestDb() called before startPostgres()');
  }
  return testDb;
}

export async function resetDb(): Promise<void> {
  if (!testSql) {
    throw new Error('resetDb() called before startPostgres()');
  }
  await testSql`TRUNCATE chat_oauth_installs, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
}
