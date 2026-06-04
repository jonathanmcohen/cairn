import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { updateUserProfile } from '@/lib/users/profile';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`;
});

async function insertUser(): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@x.com', passwordHash: 'h', name: 'Old Name' })
    .returning();
  if (!u) throw new Error('failed to insert user');
  return u.id;
}

describe('updateUserProfile (#198 K4)', () => {
  it('updates the display name', async () => {
    const userId = await insertUser();
    const user = await updateUserProfile(db, { userId, name: 'New Name' });
    expect(user.name).toBe('New Name');
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(row?.name).toBe('New Name');
  });

  it('rejects a blank/whitespace name', async () => {
    const userId = await insertUser();
    await expect(updateUserProfile(db, { userId, name: '   ' })).rejects.toThrow(/name/i);
  });

  it('rejects a name over 200 characters', async () => {
    const userId = await insertUser();
    await expect(updateUserProfile(db, { userId, name: 'x'.repeat(201) })).rejects.toThrow(/name/i);
  });

  it('persists an avatar URL and clears it with null', async () => {
    const userId = await insertUser();
    const url = 'https://example.com/api/files/abc?sig=x&exp=1';
    const withAvatar = await updateUserProfile(db, { userId, avatarUrl: url });
    expect(withAvatar.avatarUrl).toBe(url);
    const cleared = await updateUserProfile(db, { userId, avatarUrl: null });
    expect(cleared.avatarUrl).toBeNull();
  });
});
