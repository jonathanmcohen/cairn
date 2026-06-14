/**
 * One-off local e2e-DB reset (v0.10.2 F3): TRUNCATE every public table except
 * the Drizzle migration journal, so the schema + applied-migration count stay
 * intact (the boot drift-guard still passes) while ALL accumulated e2e/seed
 * data — including the duplicate a11y workspace memberships that broke the
 * workspace-scoped page lookup — is cleared. The a11y fixture re-seeds on the
 * next e2e run. NOT wired into any app path; run with `tsx scripts/reset-e2e-db.ts`.
 */
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL unset');

const sql = postgres(url, { max: 1 });

const rows = await sql<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT LIKE '\\_\\_drizzle%'
`;
const tables = rows.map((r) => `"public"."${r.tablename}"`);
if (tables.length === 0) {
  console.log('no tables to truncate');
} else {
  await sql.unsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  console.log(`truncated ${tables.length} tables`);
}
await sql.end();
