import { sweepPendingDeliveries } from '@/lib/webhooks/sweep';
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

  // Non-blocking: recover deliveries left pending/failed by a previous process
  // (in-process dispatch loses setImmediate-scheduled work on restart — §8).
  // Do NOT await — startup must not block on webhook recovery.
  sweepPendingDeliveries()
    // biome-ignore lint/suspicious/noConsole: cli startup
    .then((n) => n > 0 && console.log(`[webhooks] re-scheduled ${n} pending/failed deliveries`))
    .catch((err) => console.error('[webhooks] startup sweep failed', err));

  // Hand off to the standalone Next.js server (lives at /app/server.js in the runner image).
  // Path is resolved at runtime from /app/dist/server/entrypoint.js → /app/server.js.
  const standaloneServer = '../../server.js';
  await import(standaloneServer);
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
