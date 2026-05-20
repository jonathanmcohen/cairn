import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export async function runMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
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
      // biome-ignore lint/suspicious/noConsoleLog: CLI status output
      console.log('Migrations applied.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
