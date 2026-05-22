import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { signFileUrl } from '@/lib/files/signing';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

// Stub the storage backend so the 200 path streams an in-memory empty body
// rather than reading from /data/uploads (which doesn't exist in CI/test) — that
// would surface an unhandled ENOENT after the status assertion. We only assert
// on the route's authorization decision, not the bytes.
vi.mock('@/lib/files/get-storage', () => ({
  getStorage: () => ({ read: () => Readable.from([]) }),
}));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// The file route reads env().AUTH_SECRET, and env() caches on first call, so the
// full env must be set before any module touches it. 'x'.repeat(32) matches the
// >=32-char requirement and is what the cached env will use for verification.
const SECRET = 'x'.repeat(32);

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = SECRET;
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, files RESTART IDENTITY CASCADE`;
});

// Mirror the production signer (src/lib/files/signing.ts: HMAC-SHA256 over
// `${fileId}.${exp}` with AUTH_SECRET). We exercise the real signFileUrl for the
// valid path and forge directly here for the adversarial paths.
function forgeSig(fileId: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${fileId}.${exp}`).digest('hex');
}

async function seedFile(): Promise<string> {
  const ws = await createTestWorkspaceWithUser(db);
  const [f] = await db
    .insert(schema.files)
    .values({
      workspaceId: ws.workspaceId,
      name: 'a.png',
      path: 'p',
      size: 1,
      mimeType: 'image/png',
      uploadedBy: ws.userId,
    })
    .returning();
  if (!f) throw new Error('seed failed');
  return f.id;
}

describe('file signed-URL gate', () => {
  it('valid signature → 200', async () => {
    const fileId = await seedFile();
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signFileUrl({ fileId, expiresAt: exp, secret: SECRET });
    const route = await import('@/app/api/files/[fileId]/route');
    const res = await route.GET(new Request(`http://t/api/files/${fileId}?exp=${exp}&sig=${sig}`), {
      params: Promise.resolve({ fileId }),
    });
    expect(res.status).toBe(200);
  });

  it('forged signature → 401', async () => {
    const fileId = await seedFile();
    const exp = Math.floor(Date.now() / 1000) + 300;
    const route = await import('@/app/api/files/[fileId]/route');
    const res = await route.GET(
      new Request(`http://t/api/files/${fileId}?exp=${exp}&sig=${'0'.repeat(64)}`),
      { params: Promise.resolve({ fileId }) },
    );
    expect(res.status).toBe(401);
  });

  it('expired signature → 401 (sig itself is valid, only exp is in the past)', async () => {
    const fileId = await seedFile();
    const exp = Math.floor(Date.now() / 1000) - 60; // past
    const sig = forgeSig(fileId, exp, SECRET); // correctly signed for that exp
    const route = await import('@/app/api/files/[fileId]/route');
    const res = await route.GET(new Request(`http://t/api/files/${fileId}?exp=${exp}&sig=${sig}`), {
      params: Promise.resolve({ fileId }),
    });
    expect(res.status).toBe(401);
  });

  it('missing signature → 401', async () => {
    const fileId = await seedFile();
    const route = await import('@/app/api/files/[fileId]/route');
    const res = await route.GET(new Request(`http://t/api/files/${fileId}`), {
      params: Promise.resolve({ fileId }),
    });
    expect(res.status).toBe(401);
  });

  it('path-traversal id never returns bytes (no ../ escape)', async () => {
    const id = '../../etc/passwd';
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = forgeSig(id, exp, SECRET); // even a correctly-signed traversal id
    const route = await import('@/app/api/files/[fileId]/route');
    const res = await route.GET(
      new Request(`http://t/api/files/${encodeURIComponent(id)}?exp=${exp}&sig=${sig}`),
      { params: Promise.resolve({ fileId: id }) },
    );
    expect([400, 401, 404]).toContain(res.status); // never 200 / file bytes
  });
});
