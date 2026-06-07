/**
 * Integration regression for #140 — every export format must return 200.
 *
 * Before the fix, pdf-native.ts statically imports @playwright/test, which
 * pulls in playwright-core/browsers.json. That file is absent from the
 * standalone bundle → module-load crash → 500 for EVERY format, including
 * md and json that never call pageToPdf().
 *
 * After the fix, @playwright/test is imported dynamically inside getBrowser()
 * which is only called when CAIRN_NATIVE_PDF==='1'. These tests run with
 * CAIRN_NATIVE_PDF unset so no real Chromium is launched.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  // Ensure native PDF is off — default behaviour, print-HTML fallback.
  delete process.env.CAIRN_NATIVE_PDF;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function seedPage() {
  const u = await asUser('viewer');
  const p = await createPage(getDb(), {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'Export Regression',
  });
  await updatePage(getDb(), {
    pageId: p.id,
    workspaceId: u.workspaceId,
    byUserId: u.userId,
    adminOverride: true,
    patch: {
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] },
        ],
      },
    },
  });
  return p.id;
}

describe('GET /api/pages/[id]/export — all formats return 200 (#140)', () => {
  it('format=md (default) returns 200 + text/markdown + non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('markdown');
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('format=json returns 200 + application/json + non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=json`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('format=html returns 200 + text/html + non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=html`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
  });

  it('format=docx returns 200 + wordprocessingml + OOXML magic bytes', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=docx`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wordprocessingml.document');
    const buf = Buffer.from(await res.arrayBuffer());
    // PK zip magic (OOXML is a zip)
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('format=pdf (CAIRN_NATIVE_PDF unset) returns 200 + text/html (print-HTML fallback)', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=pdf`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    // Default path returns print-HTML for users to print via the browser dialog.
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('recursive=true returns 200 + application/zip', async () => {
    const u = await asUser('viewer');
    const root = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'Child',
    });
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(
      new Request(`http://localhost/api/pages/${root.id}/export?recursive=true`),
      { params: Promise.resolve({ pageId: root.id }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });
});
