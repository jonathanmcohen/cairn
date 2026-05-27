import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dumpDatabase, restoreDatabase } from '@/lib/upgrade/snapshot';
import { startPostgres, stopPostgres } from '../../helpers/db';

let connectionString = '';

beforeAll(async () => {
  connectionString = await startPostgres();
});

afterAll(async () => {
  await stopPostgres();
});

describe('snapshot', () => {
  it('dumps a database to a gzipped SQL file', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await db.execute(sql`CREATE TABLE IF NOT EXISTS snap_t (id int)`);
      await db.execute(sql`INSERT INTO snap_t (id) VALUES (1), (2), (3)`);
    } finally {
      await client.end();
    }

    const dir = mkdtempSync(join(tmpdir(), 'cairn-snap-'));
    const out = await dumpDatabase({ databaseUrl: connectionString, outDir: dir });
    expect(out.path.endsWith('.sql.gz')).toBe(true);
    expect(statSync(out.path).size).toBeGreaterThan(0);
    expect(out.bytesWritten).toBeGreaterThan(0);
    // gzip magic bytes 0x1f 0x8b
    const head = readFileSync(out.path).subarray(0, 2);
    expect(head[0]).toBe(0x1f);
    expect(head[1]).toBe(0x8b);
  });

  it('restores from a dump file (data survives a wipe)', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await db.execute(sql`DROP TABLE IF EXISTS snap_r`);
      await db.execute(sql`CREATE TABLE snap_r (id int)`);
      await db.execute(sql`INSERT INTO snap_r (id) VALUES (42)`);
    } finally {
      await client.end();
    }

    const dir = mkdtempSync(join(tmpdir(), 'cairn-snap-'));
    const dump = await dumpDatabase({ databaseUrl: connectionString, outDir: dir });

    const client2 = postgres(connectionString, { max: 1 });
    const db2 = drizzle(client2);
    try {
      await db2.execute(sql`DROP TABLE snap_r`);
    } finally {
      await client2.end();
    }

    await restoreDatabase({ databaseUrl: connectionString, dumpPath: dump.path });

    const client3 = postgres(connectionString, { max: 1 });
    const db3 = drizzle(client3);
    try {
      const rows = (await db3.execute(sql`SELECT id FROM snap_r ORDER BY id`)) as unknown as Array<{
        id: number;
      }>;
      expect(rows.map((r) => r.id)).toEqual([42]);
    } finally {
      await client3.end();
    }
  });
});
