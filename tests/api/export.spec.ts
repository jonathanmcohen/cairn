/**
 * Plan A1 (#140) — export route must not 500 in the standalone artifact.
 *
 * Real assertions (the original stub was it.todo). Two layers:
 *   1. Build-graph guard — the export route's source closure must contain NO
 *      static `from '@playwright/test'`. A static value import there makes
 *      next-build standalone trace playwright-core/browsers.json (absent from
 *      the bundle) → module-load crash → 500 for EVERY format.
 *   2. Per-format integration — md/json/html/docx → 200 + content-type +
 *      non-empty; recursive → application/zip; pdf default → 200 text/html.
 *
 * See docs/superpowers/plans/v0.9.14/plan-A-critical-hotfixes.md +
 * postmortem-export-500.md. Sibling suites with the same coverage:
 * tests/api/export-build-guard.test.ts, tests/api/pages-export-all-formats.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

const root = process.cwd();

/** Static value import (not `import type`, not dynamic `await import()`). */
function hasStaticPlaywrightImport(source: string): boolean {
  return /^import\s+(?!type\b)[^;]+from\s+['"]@playwright\/test['"]/m.test(source);
}

describe('Plan A1 #140 — export route static-import closure', () => {
  it('export route static-import closure contains NO `from "@playwright/test"` (build-graph guard)', () => {
    const pdfNativeSrc = readFileSync(join(root, 'src/lib/export/pdf-native.ts'), 'utf8');
    const exportRouteSrc = readFileSync(
      join(root, 'src/app/api/pages/[pageId]/export/route.ts'),
      'utf8',
    );
    expect(hasStaticPlaywrightImport(pdfNativeSrc)).toBe(false);
    expect(hasStaticPlaywrightImport(exportRouteSrc)).toBe(false);
    // The lazy path must exist in pdf-native.ts.
    expect(pdfNativeSrc).toMatch(/await\s+import\(['"]@playwright\/test['"]\)/);
  });
});

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
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
    title: 'Export Spec',
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

describe('Plan A1 #140 — page export per-format', () => {
  it('format=md → 200, text/markdown, non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('markdown');
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('format=json → 200, application/json, non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=json`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toBeDefined();
  });

  it('format=html → 200, text/html, non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=html`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<!doctype html>');
  });

  it('format=docx → 200, docx content-type, non-empty body', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=docx`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wordprocessingml.document');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('format=pdf (default pdf-print-html) → 200, text/html', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${pageId}/export?format=pdf`), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('recursive=1 → 200, application/zip', async () => {
    const u = await asUser('viewer');
    const rootPage = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: rootPage.id,
      title: 'Child',
    });
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(
      new Request(`http://localhost/api/pages/${rootPage.id}/export?recursive=true`),
      { params: Promise.resolve({ pageId: rootPage.id }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });
});
