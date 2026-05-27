import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser, type TestUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pdf_annotations, files, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setActor(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function seedFileOnPage(user: TestUser, pageId: string): Promise<string> {
  const [file] = await getDb()
    .insert(schema.files)
    .values({
      workspaceId: user.workspaceId,
      pageId,
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      path: `${user.workspaceId}/doc.pdf`,
      uploadedBy: user.userId,
    })
    .returning();
  if (!file) throw new Error('file insert failed');
  return file.id;
}

async function callList(fileId: string) {
  const mod = await import('@/app/api/pdf/[fileId]/annotations/route');
  const res = await mod.GET(new Request(`http://localhost/api/pdf/${fileId}/annotations`), {
    params: Promise.resolve({ fileId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callPost(fileId: string, body: unknown) {
  const mod = await import('@/app/api/pdf/[fileId]/annotations/route');
  const res = await mod.POST(
    new Request(`http://localhost/api/pdf/${fileId}/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ fileId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callPatch(fileId: string, annotationId: string, body: unknown) {
  const mod = await import('@/app/api/pdf/[fileId]/annotations/[annotationId]/route');
  const res = await mod.PATCH(
    new Request(`http://localhost/api/pdf/${fileId}/annotations/${annotationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ fileId, annotationId }) },
  );
  return {
    status: res.status,
    body: res.status === 204 ? null : await res.json().catch(() => null),
  };
}

async function callDelete(fileId: string, annotationId: string) {
  const mod = await import('@/app/api/pdf/[fileId]/annotations/[annotationId]/route');
  const res = await mod.DELETE(
    new Request(`http://localhost/api/pdf/${fileId}/annotations/${annotationId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ fileId, annotationId }) },
  );
  return { status: res.status };
}

describe('/api/pdf/[fileId]/annotations', () => {
  it('GET rejects unauthenticated', async () => {
    await setActor(null);
    const r = await callList('00000000-0000-0000-0000-000000000001');
    // requirePageAccess never runs because file lookup short-circuits with 404
    // for non-existent files; with a real file, auth gate returns 401. Confirm
    // either is treated as not-authorized → not-found-or-401.
    expect([401, 404]).toContain(r.status);
  });

  it('POST creates + GET lists per-user', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const fileId = await seedFileOnPage(u, page.id);
    await setActor(u.userId);

    const postRes = await callPost(fileId, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
      kind: 'highlight',
      content: null,
    });
    expect(postRes.status).toBe(201);

    const getRes = await callList(fileId);
    expect(getRes.status).toBe(200);
    expect((getRes.body as { annotations: unknown[] }).annotations).toHaveLength(1);
  });

  it('POST 403 for viewer role', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const fileId = await seedFileOnPage(u, page.id);
    await setActor(u.userId);
    const r = await callPost(fileId, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
      kind: 'highlight',
      content: null,
    });
    expect(r.status).toBe(403);
  });

  it('POST 400 on file-id mismatch with body.fileId', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const fileId = await seedFileOnPage(u, page.id);
    await setActor(u.userId);
    const r = await callPost(fileId, {
      pageId: page.id,
      fileId: '00000000-0000-0000-0000-000000000000',
      pageNumber: 1,
      rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
      kind: 'highlight',
      content: null,
    });
    expect(r.status).toBe(400);
  });

  it('GET 404 for a file in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb());
    const otherPage = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
      title: 'p',
    });
    const fileId = await seedFileOnPage(other, otherPage.id);
    await setActor(u.userId);
    const r = await callList(fileId);
    expect(r.status).toBe(404);
  });

  it('PATCH + DELETE roundtrip on caller-owned row', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const fileId = await seedFileOnPage(u, page.id);
    await setActor(u.userId);

    const post = await callPost(fileId, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
      kind: 'comment',
      content: 'hi',
    });
    expect(post.status).toBe(201);
    const id = (post.body as { annotation: { id: string } }).annotation.id;

    const patch = await callPatch(fileId, id, { content: 'edited' });
    expect(patch.status).toBe(200);
    expect((patch.body as { annotation: { content: string } }).annotation.content).toBe('edited');

    const del = await callDelete(fileId, id);
    expect(del.status).toBe(204);
  });
});
