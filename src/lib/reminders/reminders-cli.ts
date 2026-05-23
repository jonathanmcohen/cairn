import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { scanReminders } from './scan';

export async function runRemindersScan(): Promise<{ fired: number }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for reminders:scan');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    const fired = await scanReminders(db, new Date());
    return { fired };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
