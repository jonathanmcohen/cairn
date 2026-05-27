import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { verifyFileUrl } from '@/lib/files/signing';
import { getPublishedPageBySlug, resignDocumentImages } from '@/lib/pages/public';
import { publishPage } from '@/lib/pages/publish';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makePublishedPage(workspaceId: string, userId: string, title = 'Roadmap') {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  const { slug } = await publishPage(db, { pageId: p.id, workspaceId, actorUserId: userId });
  return { page: p, slug };
}

describe('getPublishedPageBySlug', () => {
  it('returns a published, non-deleted page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { slug, page } = await makePublishedPage(u.workspaceId, u.userId);
    const found = await getPublishedPageBySlug(db, slug);
    expect(found?.id).toBe(page.id);
  });

  it('returns null for an unpublished page (slug retained)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { slug, page } = await makePublishedPage(u.workspaceId, u.userId);
    await db.update(schema.pages).set({ published: false }).where(eq(schema.pages.id, page.id));
    expect(await getPublishedPageBySlug(db, slug)).toBeNull();
  });

  it('returns null for a soft-deleted page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { slug, page } = await makePublishedPage(u.workspaceId, u.userId);
    await db
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pages.id, page.id));
    expect(await getPublishedPageBySlug(db, slug)).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await getPublishedPageBySlug(db, 'does-not-exist-abc123')).toBeNull();
  });
});

const SECRET = 'y'.repeat(32);

function parseSignedUrl(url: string): { id: string; sig: string; exp: number } {
  const m = url.match(/^\/api\/files\/([^?]+)\?sig=([^&]+)&exp=(\d+)$/);
  if (!m) throw new Error(`not a signed file url: ${url}`);
  return { id: m[1] as string, sig: m[2] as string, exp: Number(m[3]) };
}

describe('resignDocumentImages', () => {
  it("re-signs a cairnImage node's src from its fileId", () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'cairnImage',
          attrs: { src: '/api/files/abc?sig=stale&exp=1', alt: 'x', fileId: 'abc' },
        },
      ],
    };
    const out = resignDocumentImages(doc, SECRET) as typeof doc;
    const src = out.content[0]?.attrs?.src as string;
    const parsed = parseSignedUrl(src);
    expect(parsed.id).toBe('abc');
    expect(
      verifyFileUrl({ fileId: 'abc', expiresAt: parsed.exp, sig: parsed.sig, secret: SECRET }),
    ).toBe(true);
    expect(parsed.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  // v0.8.0 P24: the video upload node carries a `fileId` + `mimeType` and a
  // transient `src` override that the public-render path fills with a fresh
  // signed `/api/files/<id>?sig=&exp=` URL. The editor's renderHTML prefers
  // that override over the bare `/api/files/<id>` fallback.
  it("re-signs a video node's src from its fileId", () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'video',
          attrs: { fileId: 'vid', mimeType: 'video/mp4', src: null },
        },
      ],
    };
    const out = resignDocumentImages(doc, SECRET) as {
      content: Array<{ attrs?: { src?: string | null } }>;
    };
    const src = out.content[0]?.attrs?.src as unknown as string;
    const parsed = parseSignedUrl(src);
    expect(parsed.id).toBe('vid');
    expect(
      verifyFileUrl({ fileId: 'vid', expiresAt: parsed.exp, sig: parsed.sig, secret: SECRET }),
    ).toBe(true);
  });

  it("re-signs a cairnAudio node's src from its fileId (v0.9.0 G3 P22)", () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'cairnAudio',
          attrs: { fileId: 'aud', mime: 'audio/mpeg', name: 'song.mp3', src: null },
        },
      ],
    };
    const out = resignDocumentImages(doc, SECRET) as typeof doc;
    const src = out.content[0]?.attrs?.src as string;
    const parsed = parseSignedUrl(src);
    expect(parsed.id).toBe('aud');
    expect(
      verifyFileUrl({ fileId: 'aud', expiresAt: parsed.exp, sig: parsed.sig, secret: SECRET }),
    ).toBe(true);
  });

  it("re-signs a fileAttachment node's href from its fileId", () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'fileAttachment',
          attrs: { href: '/api/files/def?sig=stale&exp=1', name: 'f.pdf', fileId: 'def' },
        },
      ],
    };
    const out = resignDocumentImages(doc, SECRET) as typeof doc;
    const href = out.content[0]?.attrs?.href as string;
    expect(parseSignedUrl(href).id).toBe('def');
  });

  it('leaves nodes without a fileId untouched and does not mutate the input', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://external/x.png' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      ],
    };
    const before = JSON.stringify(doc);
    const out = resignDocumentImages(doc, SECRET) as typeof doc;
    expect(out.content[0]?.attrs?.src).toBe('https://external/x.png');
    expect(JSON.stringify(doc)).toBe(before); // input not mutated
  });

  it('walks nested content (e.g. inside a callout)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [
            {
              type: 'cairnImage',
              attrs: { src: '/api/files/nested?sig=stale&exp=1', fileId: 'nested' },
            },
          ],
        },
      ],
    };
    const out = resignDocumentImages(doc, SECRET) as typeof doc;
    const inner = (out.content[0]?.content?.[0]?.attrs?.src ?? '') as string;
    expect(parseSignedUrl(inner).id).toBe('nested');
  });
});
