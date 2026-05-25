import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | null = null;

export async function startPostgres(): Promise<string> {
  if (container) return container.getConnectionUri();
  // ghcr.io/jonathanmcohen/postgres-pgvector:18-alpine — Postgres 18 +
  // pgvector. Built by .github/workflows/postgres-pgvector-image.yml from
  // docker/postgres-pgvector/Dockerfile. Same ref across CI services,
  // Testcontainers, and docker-compose.
  container = await new PostgreSqlContainer('ghcr.io/jonathanmcohen/postgres-pgvector:18-alpine')
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
