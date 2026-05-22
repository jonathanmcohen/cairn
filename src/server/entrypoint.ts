import { runMigrations } from '../db/migrate.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: cli startup
  console.log('Running migrations...');
  await runMigrations(url);
  // biome-ignore lint/suspicious/noConsole: cli startup
  console.log('Migrations complete.');

  // NOTE: the webhook startup sweep (recovering pending/failed deliveries left
  // by a previous process) runs from `src/instrumentation.ts#register()` inside
  // the Next app, NOT here. The entrypoint stays a minimal ESM orchestrator with
  // only relative imports — pulling the `@/`-aliased webhook/db graph in here
  // breaks `node dist/server/entrypoint.js` at runtime (no path-map resolution).

  // Hand off to the standalone Next.js server (lives at /app/server.js in the runner image).
  // Path is resolved at runtime from /app/dist/server/entrypoint.js → /app/server.js.
  const standaloneServer = '../../server.js';
  await import(standaloneServer);
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
