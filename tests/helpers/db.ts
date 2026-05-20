import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | null = null;

export async function startPostgres(): Promise<string> {
  if (container) return container.getConnectionUri();
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('cairn_test')
    .withUsername('cairn')
    .withPassword('cairn')
    .start();
  return container.getConnectionUri();
}

export async function stopPostgres(): Promise<void> {
  if (container) {
    await container.stop();
    container = null;
  }
}
