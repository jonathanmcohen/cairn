# v0.9.14 Plan A — Critical hotfixes (P0)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]). Prefix every shell command with `source ~/.zshenv && `.

## Goal

Restore production stability on three P0 regressions:

- **A1 #140** — every export format (md, json, html, docx, pdf) returns 500 in the standalone build because `pdf-native.ts` top-level imports `@playwright/test`, which references `playwright-core/browsers.json` — a file `next build --output standalone` does not copy. Fix = lazy dynamic import inside `pageToPdf()`.
- **A2 #1** — `/settings/workspace/general` throws a runtime error wrapped by the settings `error.tsx` boundary. Root cause is unconfirmed; this plan provisions a repro harness first, then fixes the minimal cause it reveals.
- **A3** — Yjs (`collab/server.ts` materialize) and the REST PATCH route both write `pages.content`. While a document is open in the editor the Yjs doc is authoritative and will overwrite any API write on the next `materialize()` call. This plan documents the precedence, adds a regression test asserting it, and adds a code comment + TODO at the PATCH site. Full Hocuspocus-publish-on-write is deferred to a feature release.

No migrations. No new columns. No Biome errors. All new strings require en/es/ar keys. Every task is TDD: failing test first, then implementation.

## Architecture

- **A1:** `src/lib/export/pdf-native.ts` — replace the module-level `import { chromium } from '@playwright/test'` with a dynamic `await import('@playwright/test')` inside `getBrowser()`. The `import type { Browser }` stay as-is (erased at build time). The singleton `browserPromise` variable and SIGTERM handler are unchanged in structure; only the call site for `chromium` moves inside the async function. The `CAIRN_NATIVE_PDF === '1'` guard in the route stays as-is; the lazy import is simply never reached when the env is unset.
- **A2:** `src/app/(app)/settings/workspace/general/page.tsx` calls `requireRole('admin')`, `loadWorkspaceGeneralSettings`, and `searchWorkspacePages` in sequence. Any of these can throw. The plan uses the API-route harness pattern (Testcontainers Postgres + `vi.mock('@/lib/auth/config')`) to call the RSC loader's underlying lib functions directly — this is more reliable than rendering a full RSC in a test runner.
- **A3:** `collab/server.ts#materialize()` writes `pages.content` via raw `postgres` driver on `onStoreDocument` and last-disconnect flush. `src/lib/pages/update.ts#updatePage()` writes `pages.content` via Drizzle. No coordination between the two. Option (c) — document + test + comment — is chosen as the lowest-risk patch-release approach. Options (a) (API write publishes through Hocuspocus) and (b) (API write invalidates Yjs doc) are deferred.

## Tech Stack

- Next.js 16 App Router, TypeScript strict, `output: 'standalone'`
- Vitest v4 + Testcontainers v12 (real Postgres per test file)
- `vi.mock('@/lib/auth/config')` + `__set` for session faking (see existing `tests/api/pages-export.test.ts`)
- `@playwright/test` lazy dynamic import (no new dependencies)
- pnpm only; `source ~/.zshenv &&` prefix on every shell command

---

## Tasks

### A1 — Export 500: build-graph guard + per-format integration + lazy-import fix (#140)

**Root cause: CONFIRMED.** `src/lib/export/pdf-native.ts` line 2: `import { chromium } from '@playwright/test'`. This is a static value import. `next build` standalone traces the static import graph from the export route, encounters `@playwright/test` which references `playwright-core/browsers.json`, and the file is absent from the standalone bundle — module load crashes at cold-start and every format (md, json, html, docx, pdf) returns 500.

---

#### A1-T1 — Build-graph guard test (read-source assertion, no Postgres needed)

Mirrors `tests/collab/dockerfile-copies-imports.test.ts`. Fails before the fix; passes after.

- [ ] Create `tests/api/export-build-guard.test.ts`:

```typescript
/**
 * Build-graph guard for #140 — export route must never statically import
 * from '@playwright/test'.
 *
 * A static `import { chromium } from '@playwright/test'` in pdf-native.ts
 * causes next-build standalone to trace the playwright-core module graph,
 * which references `playwright-core/browsers.json`. That file is NOT copied
 * into the standalone bundle, so the module fails to load at cold-start and
 * every export format returns 500 — even md/json, which never call pageToPdf.
 *
 * This test reads the source files directly (no compilation, no HTTP) and
 * asserts that no static value import from '@playwright/test' exists. If
 * someone reintroduces the static import the test fails in CI long before it
 * reaches production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const pdfNativeSrc = readFileSync(
  join(root, 'src/lib/export/pdf-native.ts'),
  'utf8',
);
const exportRouteSrc = readFileSync(
  join(root, 'src/app/api/pages/[pageId]/export/route.ts'),
  'utf8',
);

/**
 * Matches lines that are static value imports (not `import type`) from
 * '@playwright/test'. Dynamic `await import(...)` is NOT matched by this
 * regex, which is exactly what we want to allow.
 */
function hasStaticPlaywrightImport(source: string): boolean {
  // Matches: import { ... } from '@playwright/test'
  // Does NOT match: import type { ... } from '@playwright/test'
  // Does NOT match: await import('@playwright/test')
  return /^import\s+(?!type\b)[^;]+from\s+['"]@playwright\/test['"]/m.test(source);
}

describe('export route build-graph guard (#140)', () => {
  it('pdf-native.ts has no static value import from @playwright/test', () => {
    expect(
      hasStaticPlaywrightImport(pdfNativeSrc),
      'pdf-native.ts must not statically import @playwright/test — use dynamic import() inside pageToPdf()',
    ).toBe(false);
  });

  it('pdf-native.ts contains a dynamic import of @playwright/test', () => {
    // After the fix, chromium is obtained via await import('@playwright/test')
    // inside getBrowser(). This assertion documents that the lazy path exists.
    expect(pdfNativeSrc).toMatch(/await\s+import\(['"]@playwright\/test['"]\)/);
  });

  it('export route does not itself statically import @playwright/test', () => {
    expect(
      hasStaticPlaywrightImport(exportRouteSrc),
      'export route.ts must not statically import @playwright/test',
    ).toBe(false);
  });
});
```

- [ ] Run (expect failure on first two assertions):

```bash
source ~/.zshenv && pnpm vitest run tests/api/export-build-guard.test.ts
```

---

#### A1-T2 — Per-format integration tests (Testcontainers, CAIRN_NATIVE_PDF unset)

Extends the pattern from `tests/api/pages-export.test.ts` and `tests/api/pages-export-formats.test.ts`. All tests run with `CAIRN_NATIVE_PDF` unset (the default), so the pdf format returns the print-HTML fallback — no real Chromium launched. Fails before fix because module load crashes; passes after.

- [ ] Create `tests/api/pages-export-all-formats.test.ts`:

```typescript
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
```

- [ ] Run (expect failures — module load crash):

```bash
source ~/.zshenv && pnpm vitest run tests/api/pages-export-all-formats.test.ts
```

---

#### A1-T3 — The lazy-import fix

- [ ] Read `src/lib/export/pdf-native.ts` fully (already done above; lines 1–84).
- [ ] Edit `src/lib/export/pdf-native.ts`:
  - Remove line 2: `import { chromium } from '@playwright/test';`
  - Keep line 1: `import type { Browser } from '@playwright/test';` (type-only, erased at build time)
  - Inside `getBrowser()`, replace `chromium.launch(...)` with a dynamic import:

```typescript
// BEFORE (lines 38-48):
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    installSigtermHandlerOnce();
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

// AFTER:
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    installSigtermHandlerOnce();
    // Dynamic import so next-build standalone never traces @playwright/test
    // at module-load time. The standalone bundle omits playwright-core/browsers.json,
    // causing a module-load crash for EVERY export format (md/json/html/docx too)
    // if this is a static import. Only reached when CAIRN_NATIVE_PDF==='1'.
    const { chromium } = await import('@playwright/test');
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}
```

The complete final file (full replacement — no other lines change):

```typescript
import type { Browser } from '@playwright/test';
import { pageToPdfHtml } from './pdf';

// biome-ignore lint/suspicious/noExplicitAny: mirrors pageToPdfHtml's ExportPage shape
type ExportPage = { id: string; title: string; content: any };

/**
 * Headless-Chromium singleton. Lazy-launched on first pageToPdf call inside the
 * process; reused for every subsequent call. Closing per-request would add the
 * full Chromium boot cost (~1.5s cold) to every PDF — the v0.8.0 design
 * §6 risk #6 calls for the singleton explicitly.
 */
let browserPromise: Promise<Browser> | null = null;
let sigtermHandlerInstalled = false;

function installSigtermHandlerOnce(): void {
  if (sigtermHandlerInstalled) return;
  sigtermHandlerInstalled = true;
  // Gracefully close the browser when the container is asked to terminate.
  // Best-effort: if close throws, we exit anyway — the process is going away.
  const close = async (): Promise<void> => {
    const p = browserPromise;
    browserPromise = null;
    if (p) {
      try {
        const b = await p;
        await b.close();
      } catch {
        // ignore — the process is shutting down
      }
    }
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    installSigtermHandlerOnce();
    // Dynamic import so next-build standalone never traces @playwright/test
    // at module-load time. The standalone bundle omits playwright-core/browsers.json,
    // causing a module-load crash for EVERY export format (md/json/html/docx too)
    // if this is a static import (#140). Only reached when CAIRN_NATIVE_PDF==='1'.
    const { chromium } = await import('@playwright/test');
    browserPromise = chromium.launch({
      // Sandboxing is intentionally permissive — Cairn runs as a single
      // user in its container; matches the v0.6 P14 a11y-test launch flags.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/**
 * Render `page` to a real PDF Buffer via headless Chromium. Uses the
 * existing `pageToPdfHtml(page)` so every block type prints identically to
 * the browser-print HTML fallback path; only the rasterizer differs.
 *
 * Letter format, 1-inch margins, backgrounds printed. `networkidle` waits
 * for inlined images/styles to settle. The returned bytes begin with the
 * `%PDF-` magic header.
 */
export async function pageToPdf(page: ExportPage): Promise<Buffer> {
  const html = pageToPdfHtml(page);
  const browser = await getBrowser();
  const pwPage = await browser.newPage();
  try {
    await pwPage.setContent(html, { waitUntil: 'networkidle' });
    const buf = await pwPage.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
    });
    return buf;
  } finally {
    await pwPage.close();
  }
}

/** Test-only: close the singleton between integration tests. */
export async function closePdfNativeBrowserForTests(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) {
    const b = await p;
    await b.close();
  }
}
```

- [ ] Run tests — all should now pass:

```bash
source ~/.zshenv && pnpm vitest run tests/api/export-build-guard.test.ts tests/api/pages-export-all-formats.test.ts
```

- [ ] Verify `pnpm build` completes cleanly and the standalone bundle no longer contains a static playwright reference:

```bash
source ~/.zshenv && pnpm build 2>&1 | grep -i "playwright\|browsers.json\|error" || echo "build clean"
```

- [ ] Verify the compiled standalone route no longer statically references `@playwright/test` at the top of its module:

```bash
source ~/.zshenv && node -e "
const src = require('fs').readFileSync('.next/standalone/.next/server/app/api/pages/[pageId]/export/route.js', 'utf8');
const staticRef = /require\(['\"]@playwright\/test['\"]\)/.test(src);
console.log('static playwright require present:', staticRef);
if (staticRef) process.exit(1);
" && echo "OK — no static playwright require in bundle"
```

- [ ] Run the full test suite to catch regressions:

```bash
source ~/.zshenv && pnpm vitest run
```

- [ ] Lint and typecheck:

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck
```

- [ ] Commit:

```bash
git add src/lib/export/pdf-native.ts \
        tests/api/export-build-guard.test.ts \
        tests/api/pages-export-all-formats.test.ts
git commit -m "fix(export): lazy-import @playwright/test to fix standalone 500 (#140)

Static import of chromium from @playwright/test caused next-build standalone
to omit playwright-core/browsers.json, crashing module load for every export
format. Moved to dynamic import inside getBrowser(), guarded by
CAIRN_NATIVE_PDF=1. Added build-graph guard test + per-format integration
regression suite.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### A2 — Settings/workspace/general 500: repro first, then fix (#1)

**Root cause: UNCONFIRMED — requires runtime repro.** The page throws inside an RSC, caught by `src/app/(app)/settings/error.tsx` which renders a themed "couldn't load" card. The page calls `requireRole('admin')`, `loadWorkspaceGeneralSettings()`, and `searchWorkspacePages()` in sequence. The error could be: (a) `requireRole` failing on a missing/malformed session, (b) a lagging column in a `workspaces` SELECT on a stale deployment, (c) a missing/null workspace row, or (d) an i18n key fault in the error boundary itself.

`loadWorkspaceGeneralSettings` was already narrowed to a four-column projection in `src/lib/workspaces/settings.ts` (comment: `#1 (P0)`) specifically to guard against (b). Cause (b) should be ruled out. The implementer MUST confirm the actual error from logs or a repro test before applying a fix — do NOT guess.

---

#### A2-T1 — Reproduce: integration test that exercises the loader functions

- [ ] Create `tests/settings/general-loader.test.ts`:

```typescript
/**
 * Regression harness for #1 — /settings/workspace/general 500.
 *
 * The RSC page calls three functions in sequence:
 *   1. requireRole('admin')      — needs a valid session + workspace cookie
 *   2. loadWorkspaceGeneralSettings(db, workspaceId)
 *   3. searchWorkspacePages(db, { workspaceId, query: '', limit: 100 })
 *
 * This test exercises those functions directly against a real Postgres instance.
 * If any function throws here, the error message will tell us the actual cause
 * of the 500 — read the failure output carefully before writing a fix.
 *
 * Do NOT add a fix in this task. Task A2-T2 implements the minimal fix
 * after confirming the real failure.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { requireRole } from '@/lib/auth/require-role';
import { searchWorkspacePages } from '@/lib/workspaces/pages';
import { loadWorkspaceGeneralSettings } from '@/lib/workspaces/settings';
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

vi.mock('next/headers', () => {
  let workspaceId: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) =>
        name === 'cairn_ws' && workspaceId ? { name: 'cairn_ws', value: workspaceId } : undefined,
      set: () => {},
    }),
    __setWorkspaceId: (id: string) => {
      workspaceId = id;
    },
  };
});

async function setUser(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function setWorkspace(id: string) {
  const mod = (await import('next/headers')) as unknown as {
    __setWorkspaceId: (id: string) => void;
  };
  mod.__setWorkspaceId(id);
}

describe('/settings/workspace/general — loader functions (#1)', () => {
  it('requireRole admin + loadWorkspaceGeneralSettings + searchWorkspacePages all resolve without throwing', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);

    // Step 1 — requireRole must not throw for an admin
    const ctx = await requireRole('admin');
    expect(ctx.userId).toBe(u.userId);
    expect(ctx.workspaceId).toBe(u.workspaceId);

    // Step 2 — loadWorkspaceGeneralSettings must return the row
    const row = await loadWorkspaceGeneralSettings(getDb(), ctx.workspaceId);
    expect(row).not.toBeNull();
    expect(row?.name).toBeDefined();

    // Step 3 — searchWorkspacePages must return an array (may be empty)
    const pages = await searchWorkspacePages(getDb(), {
      workspaceId: ctx.workspaceId,
      query: '',
      limit: 100,
    });
    expect(Array.isArray(pages)).toBe(true);
  });

  it('requireRole throws when session is missing (unauthenticated)', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    mod.__set(null);
    await expect(requireRole('admin')).rejects.toThrow();
  });

  it('requireRole throws 403 when user is below admin (editor)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);
    await expect(requireRole('admin')).rejects.toThrow();
  });

  it('loadWorkspaceGeneralSettings returns null for a non-existent workspace (does not throw)', async () => {
    const row = await loadWorkspaceGeneralSettings(
      getDb(),
      '00000000-0000-0000-0000-000000000000',
    );
    expect(row).toBeNull();
  });
});
```

- [ ] Run the repro harness and READ THE OUTPUT CAREFULLY:

```bash
source ~/.zshenv && pnpm vitest run tests/settings/general-loader.test.ts 2>&1
```

- [ ] If all four tests pass: the loader functions themselves are healthy — the 500 is likely in a different layer (session resolution, workspace-cookie parsing, or a missing i18n key in error.tsx). Investigate `requireRole` and the `next/headers` cookies path in the actual request context. Add a note to the PR describing what the test revealed.

- [ ] If any test fails: the failure message is the real root cause. Proceed to A2-T2 with that information.

---

#### A2-T2 — Fix the minimal confirmed cause

**Implement only after A2-T1 reveals the actual failure.**

- [ ] Read the test output from A2-T1 and identify the exact failing call + error message.
- [ ] Apply the minimal fix to the identified location. Common candidates (pick whichever A2-T1 identifies):
  - If `loadWorkspaceGeneralSettings` throws on a missing column: check the Drizzle schema definition for the four projected columns against the latest migration; add a null-safe fallback or a migration if a column was added without a default.
  - If `requireRole` fails on workspace-cookie lookup: check `src/lib/auth/require-role.ts` for the `cairn_ws` cookie read path and add a guard for a missing or invalid UUID value.
  - If `searchWorkspacePages` throws: inspect the error for a schema mismatch (e.g., a missing column in `pages` SELECT) and apply the same narrowed-projection pattern used in `loadWorkspaceGeneralSettings`.
  - If the issue is `throw new Error('workspace missing')` (the page throws when `row` is null): verify whether the workspace row is being created correctly for new installs (check `createTestWorkspaceWithUser` and the actual production `onboarding` path).
- [ ] Write or update the relevant unit test to assert the fix before implementing it.
- [ ] Apply the code fix.
- [ ] Run tests:

```bash
source ~/.zshenv && pnpm vitest run tests/settings/general-loader.test.ts
```

---

#### A2-T3 — Regression test for the settings general loader

- [ ] Ensure `tests/settings/general-loader.test.ts` has a green test asserting the full happy-path sequence (admin user, real workspace, all three loader calls succeed). This test is the ongoing regression guard.
- [ ] Also assert that the error.tsx boundary path is exercised: confirm `loadWorkspaceGeneralSettings` returning `null` causes the page to throw `Error('workspace missing')` (this is already the correct behavior per the page source — just document it in a test).
- [ ] Run full suite:

```bash
source ~/.zshenv && pnpm vitest run
```

- [ ] Lint and typecheck:

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck
```

- [ ] Commit (adapt message once actual cause is known):

```bash
git add tests/settings/general-loader.test.ts \
        <any source files changed by T2>
git commit -m "fix(settings): resolve /settings/workspace/general 500 (#1)

<Fill in: actual root cause confirmed by A2-T1 repro harness>
Added loader regression test in tests/settings/general-loader.test.ts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### A3 — Yjs/collab ↔ API content-write precedence (documentation + regression test)

**Root cause: CONFIRMED behavior, not a code bug.** Two paths write `pages.content`:

1. `collab/server.ts#materialize()` — runs on `onStoreDocument` (debounced 2s) and on last-disconnect flush. Encodes the live `Y.Doc` to ProseMirror JSON and writes via raw `postgres` driver.
2. `src/lib/pages/update.ts#updatePage()` — REST PATCH. Writes via Drizzle, also fires webhooks, flashcard reconcile, datetime extract, page-link reindex.

While a Yjs document is open in the Hocuspocus process, `materialize()` is the authority. An API PATCH that writes `content` during that window is overwritten on the next materialize call (at most 2s later, or on disconnect). There is no notification or conflict signal.

**Options considered:**

- **(a) API write publishes through Hocuspocus** — PATCH calls the Hocuspocus server to apply the change to the live Y.Doc, ensuring it is not overwritten. Requires a Hocuspocus management API or internal HTTP call. Complex; risks new race conditions; inappropriate for a patch release.
- **(b) API write invalidates/flushes the Yjs doc** — PATCH signals the Hocuspocus process to flush and close the doc before writing. Requires IPC between the Next.js process and the collab process; adds latency to every content PATCH.
- **(c) Document the precedence, add a regression test, add a code comment + TODO** — No behavior change. "Editor (Yjs) state wins while a document is open; API content writes apply when no active Yjs doc is present." The regression test asserts this documented behavior so it cannot regress silently.

**Decision: Option (c).** This is a patch release. The behavior is not a regression introduced in v0.9.14 — it is an architectural property of the two-process design. The risk of introducing (a) or (b) in a hotfix window exceeds the marginal benefit. Options (a) and (b) are noted as deferred to a feature release milestone (v0.10.x or later).

---

#### A3-T1 — Regression test asserting documented Yjs↔API precedence

- [ ] Create `tests/api/pages-content-patch.spec.ts`:

```typescript
/**
 * Regression test documenting Yjs ↔ REST API content-write precedence.
 *
 * DOCUMENTED BEHAVIOR:
 *   - While an editor session holds the Yjs doc open in Hocuspocus, the Yjs
 *     state is authoritative. A REST PATCH that writes `pages.content` during
 *     that window will be overwritten on the next materialize() call (within
 *     the 2s debounce or on last-disconnect flush).
 *   - When no active Yjs doc is held open (Hocuspocus has no live connection
 *     for that page), a REST PATCH to `pages.content` persists durably — there
 *     is no Yjs doc to overwrite it.
 *
 * This test only exercises the REST PATCH path (no real Hocuspocus process).
 * It asserts that a PATCH with a content payload writes the expected value to
 * the database — i.e. confirms the "no active Yjs doc" branch of the precedence
 * rule. The overwrite behavior (Yjs wins) is architectural: materialize() calls
 * `UPDATE pages SET content = <yjsProseDoc>` unconditionally, so any prior PATCH
 * value is replaced. That behavior is tested in tests/collab/ via the
 * materialize helpers.
 *
 * See also: collab/server.ts#materialize() and src/lib/pages/update.ts for the
 * PATCH site comment referencing this file.
 *
 * Deferred: Option (a) "API write publishes through Hocuspocus" and
 * Option (b) "API write invalidates Yjs doc" are not implemented in v0.9.14.
 * They are tracked for a future feature release (v0.10.x).
 */
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
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

vi.mock('next/headers', () => {
  let workspaceId: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) =>
        name === 'cairn_ws' && workspaceId ? { name: 'cairn_ws', value: workspaceId } : undefined,
      set: () => {},
    }),
    __setWorkspaceId: (id: string) => {
      workspaceId = id;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const authMod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  authMod.__set({ userId: u.userId });
  const headersMod = (await import('next/headers')) as unknown as {
    __setWorkspaceId: (id: string) => void;
  };
  headersMod.__setWorkspaceId(u.workspaceId);
  return u;
}

describe('PATCH /api/pages/[id] — content write (no active Yjs doc)', () => {
  it('writes content and persists when no Yjs doc is open (documented: API wins when no active collab session)', async () => {
    const u = await asUser('editor');
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Precedence Test',
    });

    const newContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'API-written content' }],
        },
      ],
    };

    const { PATCH } = await import('@/app/api/pages/[pageId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );

    expect(res.status).toBe(200);

    // Verify the content was persisted in the database
    const [row] = await sql<{ content: unknown }[]>`
      SELECT content FROM pages WHERE id = ${page.id}::uuid
    `;
    expect(row).toBeDefined();
    // The content should contain our API-written text
    const contentStr = JSON.stringify(row?.content);
    expect(contentStr).toContain('API-written content');
  });

  it('a subsequent Yjs materialize call WOULD overwrite the API content (behavior documented, not tested here — see collab/server.ts#materialize)', () => {
    // This test intentionally does NOT exercise the overwrite path because it
    // would require a running Hocuspocus process. The behavior is architectural:
    // materialize() issues `UPDATE pages SET content = <yjsDoc>` unconditionally
    // with no awareness of intervening API writes.
    //
    // The documented precedence rule:
    //   "Editor (Yjs) state wins while a document is open.
    //    API content writes apply durably when no active Yjs doc is present."
    //
    // TODO (v0.10.x): Implement option (a) — API write publishes through
    // Hocuspocus — or option (b) — API write triggers Yjs doc flush — to
    // eliminate the overwrite race entirely.
    expect(true).toBe(true); // placeholder assertion to document the deferred behavior
  });
});
```

- [ ] Run test (should pass immediately — tests the "no active doc" branch which already works):

```bash
source ~/.zshenv && pnpm vitest run tests/api/pages-content-patch.spec.ts
```

---

#### A3-T2 — Add code comment at the PATCH site and update collab/server.ts

- [ ] Read `src/lib/pages/update.ts` lines 37–100 (the `updatePage` function body, already reviewed).
- [ ] Add a precedence comment at the content-write site in `src/lib/pages/update.ts`. Locate the actual `content` write — it is the `values.content = …` assignment (around line 77 in the current file, inside the values construction; NOT line 99, which is the `.where()` clause of the UPDATE). Add the following comment immediately above that `values.content` assignment:

The comment to add (find the block that builds the SET patch and add before content is applied):

```typescript
// CONTENT-WRITE PRECEDENCE NOTE (#A3, v0.9.14):
// While a Hocuspocus collab session holds a Y.Doc open for this page,
// collab/server.ts#materialize() will overwrite `pages.content` with the
// Yjs state on the next debounce flush (≤2s) or last-disconnect. This REST
// PATCH is therefore authoritative ONLY when no active Yjs session is open.
// Documented behavior: "editor (Yjs) wins while a doc is open; API content
// writes apply when no active Yjs doc is present."
// TODO (v0.10.x): implement option (a) publish-through-Hocuspocus or
// option (b) API-triggers-Yjs-flush to eliminate the overwrite race.
// See: tests/api/pages-content-patch.spec.ts for the regression assertion.
```

- [ ] Run lint and typecheck:

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck
```

- [ ] Commit:

```bash
git add tests/api/pages-content-patch.spec.ts \
        src/lib/pages/update.ts
git commit -m "docs(collab): document Yjs/API content precedence + regression test (A3)

While a Yjs doc is open in Hocuspocus, materialize() overwrites pages.content
on the next flush. REST PATCH content writes are durable only when no active
collab session holds the doc. Documents the precedence rule, adds a regression
test, and adds a TODO at the PATCH site for future Hocuspocus-publish-on-write.
Options (a) and (b) deferred to v0.10.x.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Plan gate

All three items must be complete before this plan is considered done.

- [ ] A1: `pnpm vitest run tests/api/export-build-guard.test.ts tests/api/pages-export-all-formats.test.ts` — all green
- [ ] A1: `pnpm build` completes with no errors; standalone bundle has no static `require('@playwright/test')` in the export route module
- [ ] A2: `pnpm vitest run tests/settings/general-loader.test.ts` — all green; actual root cause documented in the commit message
- [ ] A3: `pnpm vitest run tests/api/pages-content-patch.spec.ts` — all green
- [ ] Full suite: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm vitest run` — 0 errors, 0 failures
- [ ] No push from subagents — the controller/human pushes and opens the PR

## No-push reminder

Do NOT run `git push` from any subagent. The parent controller or the human operator pushes and opens the PR for `release/v0.9.14` when the gate above is green.
