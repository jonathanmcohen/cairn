import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';

// dotenv v17 logs an injection tip to the console by default; quiet keeps CLI output clean.
loadEnv({ quiet: true });

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
// Relative (NOT @/-aliased) import: this module runs under `node
// dist/server/entrypoint.js` where the TS path-map is not resolved. The
// upgrade/migrations helper only depends on drizzle-orm + node builtins, so it
// is safe to pull into this minimal ESM orchestrator. See entrypoint.ts note.
import { assertNoPendingMigrations, loadBundledJournal } from '../lib/upgrade/migrations.js';

// Resolve the migrations folder ABSOLUTELY from this module's location, NOT
// from process.cwd(). A cwd-relative `./drizzle/migrations` silently resolves
// to an empty/nonexistent folder when the container's standalone server is
// started from any directory other than the image WORKDIR — drizzle's migrator
// then finds zero pending migrations, prints success, and skips the schema
// change entirely (v0.9.4 homelab outage: `workspaces.icon` never created,
// every workspace fetch threw `column "icon" does not exist`, 42703).
//
// Both build outputs sit two levels under the app root:
//   compiled: /app/dist/db/migrate.js  → ../../drizzle/migrations = /app/drizzle/migrations
//   source:   <repo>/src/db/migrate.ts → ../../drizzle/migrations = <repo>/drizzle/migrations
// so the same relative offset is correct under Node (prod) and Vitest (tests).
const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../drizzle/migrations',
);

// Stable application-defined advisory-lock key (arbitrary, fixed for Cairn
// migrations). Serializes concurrent replicas: the first container to boot
// takes the lock and applies pending migrations; others block until it
// releases, then re-check and no-op. Prevents two replicas racing the same
// `ALTER TABLE` on a shared database.
const MIGRATION_ADVISORY_LOCK_KEY = 4021966011;

export async function runMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const db = drizzle(sql);
    // Session-level advisory lock held on this single connection for the whole
    // migrate(), then explicitly released. Concurrent replicas serialize here.
    await sql`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY})`;
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      // #1 (P0) — fail loud if the DB still trails (or leads) the bundled
      // journal AFTER migrate(). The v0.9.4 outage was a SILENT skip (wrong
      // folder → 0 pending → success → half-migrated DB served). Throwing here
      // turns that into a non-zero-exit boot failure instead.
      await assertNoPendingMigrations({ journal: await loadBundledJournal(), db });
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      // biome-ignore lint/suspicious/noConsole: CLI status output
      console.log('Migrations applied.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
