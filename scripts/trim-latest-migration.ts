/**
 * One-off gate helper (v0.10.2 F3 RED): delete the single most-recent row from
 * `drizzle.__drizzle_migrations`, dropping the applied-migration count by one so
 * the PRE-F3 base build (whose bundled journal is one entry shorter) boots past
 * the count-based drift guard (src/lib/upgrade/migrations.ts) for a clean RED.
 * The F3 build's idempotent 0079 migration re-applies + re-inserts the row on
 * the GREEN pass. NOT wired into any app path. Run: tsx scripts/trim-latest-migration.ts
 */
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL unset');

const sql = postgres(url, { max: 1 });

const loc = await sql<{ table_schema: string }[]>`
  SELECT table_schema FROM information_schema.tables
  WHERE table_name = '__drizzle_migrations'
    AND table_schema IN ('drizzle', current_schema())
  ORDER BY CASE WHEN table_schema = 'drizzle' THEN 0 ELSE 1 END
  LIMIT 1
`;
const schema = loc[0]?.table_schema;
if (!schema) {
  console.log('no __drizzle_migrations table found');
} else {
  const before = await sql.unsafe(
    `SELECT count(*)::int AS n FROM "${schema}".__drizzle_migrations`,
  );
  await sql.unsafe(
    `DELETE FROM "${schema}".__drizzle_migrations
     WHERE id = (SELECT id FROM "${schema}".__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1)`,
  );
  const after = await sql.unsafe(`SELECT count(*)::int AS n FROM "${schema}".__drizzle_migrations`);
  console.log(`trimmed migrations in "${schema}": ${before[0].n} -> ${after[0].n}`);
}
await sql.end();
