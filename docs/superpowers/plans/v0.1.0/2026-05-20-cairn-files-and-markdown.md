# Cairn Files & Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file/image uploads (local disk volume), image + file attachment blocks in the editor, cover images on pages, and markdown import/export. After this plan, users can paste/drag images into pages, attach files, set page covers, paste markdown to convert into blocks, and export pages or subtrees as `.md`/`.zip`.

**Architecture:** A `FileStorage` interface with a `LocalDiskStorage` implementation backs all uploads under `/data/uploads/<workspace-id>/<uuid>.<ext>`. Reads go through a signed-URL gate (HMAC over `(fileId, expiresAt)`) so storage paths don't leak even if the volume becomes web-served. TipTap gets two new node extensions (image, file) that render an `<img>` or download link with the signed URL pre-baked. Markdown round-trip uses `prosemirror-markdown` for both directions; multi-page export streams a zip.

**Tech Stack additions:** `prosemirror-markdown` (round-trip md↔PM JSON), `archiver` (zip streaming), `file-type` (mime sniffing), `nanoid` (short ids for uploads). No new infra services.

---

## What's in scope for Plan 4

- `files` table with workspace + page scoping
- `pages.cover_url` column (deferred from Plan 2)
- `FileStorage` interface; `LocalDiskStorage` implementation (writes/reads `/data/uploads/`)
- HMAC signed-URL helper (1-hour expiry, configurable)
- `POST /api/upload` — multipart, role-gated, mime/size validation, returns `{id, signedUrl}`
- `GET /api/files/[id]?sig=&exp=` — verifies signature, streams from disk
- TipTap image block (drag/drop + paste + slash command)
- TipTap file attachment block (download link)
- Cover image picker on the page route
- Markdown export: per-page `.md` and per-subtree `.zip`
- Markdown import: paste handler in editor + dedicated `POST /api/pages/[id]/import` endpoint
- ⌘+S manual save trigger (defensive)

## What's explicitly NOT in this plan

- S3 / MinIO backend — `FileStorage` interface ready, default stays local disk; deferred per spec
- Image transforms (resize, thumbnails) — deferred
- File preview/inline viewer beyond images — deferred (download only)
- Database blocks — Plan 5
- Release polish + tag — Plan 6
- Watermarks, scanning, AV — out of scope for homelab tooling

---

## File structure produced by this plan

```
cairn/
├── drizzle/migrations/
│   └── 0005_files_and_covers.sql       # NEW
├── src/
│   ├── app/
│   │   ├── (app)/pages/[pageId]/
│   │   │   └── page.tsx                # MODIFIED — cover image header
│   │   └── api/
│   │       ├── upload/route.ts         # NEW
│   │       ├── files/[fileId]/route.ts # NEW
│   │       └── pages/[pageId]/
│   │           ├── export/route.ts     # NEW
│   │           └── import/route.ts     # NEW
│   ├── components/
│   │   ├── editor/
│   │   │   ├── image-extension.ts      # NEW
│   │   │   ├── file-extension.ts       # NEW
│   │   │   ├── extensions.ts           # MODIFIED — wire new blocks + paste-md
│   │   │   ├── slash-extension.ts      # MODIFIED — add Image/File entries
│   │   │   └── markdown-paste.ts       # NEW — paste handler
│   │   ├── cover-image.tsx             # NEW — page header cover picker
│   │   └── upload-input.tsx            # NEW — file picker wrapper
│   ├── db/schema/
│   │   ├── files.ts                    # NEW
│   │   ├── pages.ts                    # MODIFIED — coverUrl column
│   │   └── index.ts                    # MODIFIED — export files
│   └── lib/
│       ├── files/
│       │   ├── storage.ts              # NEW — FileStorage interface + LocalDiskStorage
│       │   ├── signing.ts              # NEW — HMAC sign/verify
│       │   ├── upload.ts               # NEW — store + DB record + signed URL
│       │   └── access.ts               # NEW — requireFileAccess
│       └── markdown/
│           ├── from-prose.ts           # NEW — ProseMirror JSON → markdown
│           ├── to-prose.ts             # NEW — markdown → ProseMirror JSON
│           └── export-subtree.ts       # NEW — zip stream
└── tests/
    ├── db/files-schema.test.ts
    ├── lib/files/storage.test.ts
    ├── lib/files/signing.test.ts
    ├── lib/files/upload.test.ts
    ├── lib/markdown/round-trip.test.ts
    ├── lib/markdown/export-subtree.test.ts
    ├── api/upload.test.ts
    ├── api/files-get.test.ts
    ├── api/pages-export.test.ts
    └── api/pages-import.test.ts
```

---

## Conventions

- Same as prior plans. `pnpm`, TDD with full code, frequent conventional commits, no pushes from subagents.
- All shell prefixed `source ~/.zshenv && `.
- All routes use `requireRole` / `requirePageAccess` / a new `requireFileAccess` helper.
- File paths NEVER leak through the API — clients only ever see signed URLs.

---

## Task 1: Files schema + pages.cover_url migration

**Files:**
- Create: `src/db/schema/files.ts`
- Modify: `src/db/schema/pages.ts` (add `coverUrl`)
- Modify: `src/db/schema/index.ts`
- Generate: `drizzle/migrations/0005_*.sql`
- Create: `tests/db/files-schema.test.ts`

- [ ] **Step 1: Write `src/db/schema/files.ts`**

```ts
import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  path: text('path').notNull(), // relative path under /data/uploads
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FileRow = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
```

- [ ] **Step 2: Add `coverUrl` to `src/db/schema/pages.ts`**

Add the column inside `pgTable('pages', { ... })`, after `icon`:

```ts
coverUrl: text('cover_url'),
```

- [ ] **Step 3: Update `src/db/schema/index.ts`** — add `export * from './files';`.

- [ ] **Step 4: Write failing test `tests/db/files-schema.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('files schema + pages.cover_url', () => {
  it('inserts a file row with all required columns', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [f] = await db
      .insert(schema.files)
      .values({
        workspaceId: u.workspaceId,
        name: 'photo.png',
        mimeType: 'image/png',
        size: 12345,
        path: `${u.workspaceId}/abc.png`,
        uploadedBy: u.userId,
      })
      .returning();
    expect(f?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(f?.mimeType).toBe('image/png');
  });

  it('pages.cover_url accepts a URL string', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'P',
        createdBy: u.userId,
        coverUrl: '/api/files/abc?sig=xyz',
      })
      .returning();
    expect(p?.coverUrl).toBe('/api/files/abc?sig=xyz');
  });

  it('deleting a page nulls files.page_id (set null)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('no page');
    await db.insert(schema.files).values({
      workspaceId: u.workspaceId,
      pageId: p.id,
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 1,
      path: `${u.workspaceId}/a.txt`,
      uploadedBy: u.userId,
    });
    await sql`DELETE FROM pages WHERE id = ${p.id}`;
    const [f] = await db.select().from(schema.files);
    expect(f?.pageId).toBeNull();
  });
});
```

- [ ] **Step 5: Run, verify failure, generate migration, run, lint, commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/db/files-schema.test.ts
# expect FAIL — schema.files undefined

DATABASE_URL=postgres://cairn:cairn@localhost:5432/cairn pnpm db:generate
# creates 0005_*.sql

pnpm test tests/db/files-schema.test.ts
# expect 3 passed

pnpm lint && pnpm typecheck && pnpm test
# expect all green

git add src/db/schema/ drizzle/ tests/db/files-schema.test.ts && \
  git commit -m "feat: files table + pages.cover_url column"
```

---

## Task 2: HMAC signing utility

**Goal:** Sign `(fileId, expiresAt)` tuples with `AUTH_SECRET` so signed URLs cannot be forged. Verify on read.

**Files:**
- Create: `src/lib/files/signing.ts`
- Create: `tests/lib/files/signing.test.ts`

- [ ] **Step 1: Write failing test `tests/lib/files/signing.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { signFileUrl, verifyFileUrl } from '@/lib/files/signing';

const SECRET = 'x'.repeat(32);

describe('signFileUrl / verifyFileUrl', () => {
  it('signs and verifies a URL', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signFileUrl({ fileId: 'abc-123', expiresAt: exp, secret: SECRET });
    expect(verifyFileUrl({ fileId: 'abc-123', expiresAt: exp, sig, secret: SECRET })).toBe(true);
  });

  it('rejects tampered fileId', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signFileUrl({ fileId: 'abc-123', expiresAt: exp, secret: SECRET });
    expect(verifyFileUrl({ fileId: 'evil', expiresAt: exp, sig, secret: SECRET })).toBe(false);
  });

  it('rejects expired URLs', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = signFileUrl({ fileId: 'abc-123', expiresAt: exp, secret: SECRET });
    expect(verifyFileUrl({ fileId: 'abc-123', expiresAt: exp, sig, secret: SECRET })).toBe(false);
  });

  it('rejects bad signature', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(verifyFileUrl({ fileId: 'abc', expiresAt: exp, sig: 'deadbeef', secret: SECRET })).toBe(false);
  });
});
```

- [ ] **Step 2: Write `src/lib/files/signing.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignInput = { fileId: string; expiresAt: number; secret: string };

export function signFileUrl(input: SignInput): string {
  const h = createHmac('sha256', input.secret);
  h.update(`${input.fileId}.${input.expiresAt}`);
  return h.digest('hex');
}

export type VerifyInput = SignInput & { sig: string };

export function verifyFileUrl(input: VerifyInput): boolean {
  if (input.expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = signFileUrl(input);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(input.sig, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 3: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/files/signing.test.ts
# expect 4 passed
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/files/signing.ts tests/lib/files/signing.test.ts && \
  git commit -m "feat: HMAC signed file URL helpers"
```

---

## Task 3: LocalDiskStorage + FileStorage interface

**Goal:** Pluggable storage backend with disk-local default. The interface holds for future S3.

**Files:**
- Create: `src/lib/files/storage.ts`
- Create: `tests/lib/files/storage.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage } from '@/lib/files/storage';

let root = '';
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cairn-test-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it('writes a blob and reads it back', async () => {
    const store = new LocalDiskStorage(root);
    const buf = Buffer.from('hello');
    await store.put('ws/abc.txt', buf, 'text/plain');
    const round = await readFile(join(root, 'ws/abc.txt'));
    expect(round.toString()).toBe('hello');
  });

  it('exists() reports true after put, false otherwise', async () => {
    const store = new LocalDiskStorage(root);
    expect(await store.exists('ws/missing.txt')).toBe(false);
    await store.put('ws/exists.txt', Buffer.from('x'), 'text/plain');
    expect(await store.exists('ws/exists.txt')).toBe(true);
  });

  it('delete() removes the file', async () => {
    const store = new LocalDiskStorage(root);
    await store.put('ws/gone.txt', Buffer.from('x'), 'text/plain');
    await store.delete('ws/gone.txt');
    expect(await store.exists('ws/gone.txt')).toBe(false);
  });

  it('rejects path traversal', async () => {
    const store = new LocalDiskStorage(root);
    await expect(store.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/invalid path/i);
  });
});
```

- [ ] **Step 2: Write `src/lib/files/storage.ts`**

```ts
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type { Readable } from 'node:stream';

export interface FileStorage {
  put(path: string, body: Buffer, mimeType: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  read(path: string): Readable;
}

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(p: string): string {
    if (isAbsolute(p) || p.includes('..')) throw new Error('invalid path');
    const normalized = normalize(p);
    if (normalized.startsWith('..')) throw new Error('invalid path');
    return join(this.root, normalized);
  }

  async put(path: string, body: Buffer, _mime: string): Promise<void> {
    const full = this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true });
  }

  read(path: string): Readable {
    return createReadStream(this.resolve(path));
  }
}
```

- [ ] **Step 3: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/files/storage.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/files/storage.ts tests/lib/files/storage.test.ts && \
  git commit -m "feat: FileStorage interface + LocalDiskStorage implementation"
```

---

## Task 4: upload helper (storage + DB + signed URL)

**Goal:** A single helper `storeUpload(...)` writes to disk, records in `files` table, returns `{file, signedUrl}`.

**Files:**
- Create: `src/lib/files/upload.ts`
- Create: `tests/lib/files/upload.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';
import { storeUpload } from '@/lib/files/upload';
import { LocalDiskStorage } from '@/lib/files/storage';
import * as schema from '@/db/schema';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let root = '';
const SECRET = 'x'.repeat(32);

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  root = await mkdtemp(join(tmpdir(), 'cairn-up-'));
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('storeUpload', () => {
  it('writes the file and inserts a row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const store = new LocalDiskStorage(root);
    const result = await storeUpload({
      db,
      storage: store,
      secret: SECRET,
      workspaceId: u.workspaceId,
      uploadedBy: u.userId,
      filename: 'cat.png',
      mimeType: 'image/png',
      body: Buffer.from('PNG bytes'),
    });
    expect(result.file.name).toBe('cat.png');
    expect(result.file.mimeType).toBe('image/png');
    expect(result.signedUrl).toMatch(/^\/api\/files\/[0-9a-f-]+\?sig=[a-f0-9]+&exp=\d+$/);
  });

  it('rejects mime types not in allowlist', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const store = new LocalDiskStorage(root);
    await expect(
      storeUpload({
        db,
        storage: store,
        secret: SECRET,
        workspaceId: u.workspaceId,
        uploadedBy: u.userId,
        filename: 'evil.exe',
        mimeType: 'application/x-msdownload',
        body: Buffer.from('binary'),
      }),
    ).rejects.toThrow(/mime/i);
  });
});
```

- [ ] **Step 2: Write `src/lib/files/upload.ts`**

```ts
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { FileStorage } from './storage';
import { signFileUrl } from './signing';

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
]);

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export type StoreUploadInput = {
  db: PostgresJsDatabase<typeof schema>;
  storage: FileStorage;
  secret: string;
  workspaceId: string;
  uploadedBy: string;
  pageId?: string;
  filename: string;
  mimeType: string;
  body: Buffer;
};

export type StoreUploadResult = {
  file: schema.FileRow;
  signedUrl: string;
};

export async function storeUpload(input: StoreUploadInput): Promise<StoreUploadResult> {
  if (!ALLOWED.has(input.mimeType)) {
    throw new Error(`mime type not allowed: ${input.mimeType}`);
  }
  const id = randomUUID();
  const ext = extname(input.filename).toLowerCase().slice(0, 8);
  const path = `${input.workspaceId}/${id}${ext}`;
  await input.storage.put(path, input.body, input.mimeType);

  const [file] = await input.db
    .insert(schema.files)
    .values({
      id,
      workspaceId: input.workspaceId,
      pageId: input.pageId ?? null,
      name: input.filename,
      mimeType: input.mimeType,
      size: input.body.length,
      path,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  if (!file) throw new Error('file insert returned no row');

  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const sig = signFileUrl({ fileId: file.id, expiresAt, secret: input.secret });
  const signedUrl = `/api/files/${file.id}?sig=${sig}&exp=${expiresAt}`;

  return { file, signedUrl };
}
```

- [ ] **Step 3: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/files/upload.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/files/upload.ts tests/lib/files/upload.test.ts && \
  git commit -m "feat: storeUpload helper (disk + DB + signed URL)"
```

---

## Task 5: POST /api/upload

**Goal:** Multipart endpoint; editor+ only; respects `CAIRN_MAX_UPLOAD_MB`.

**Files:**
- Create: `src/app/api/upload/route.ts`
- Create: `tests/api/upload.test.ts`
- Create: `src/lib/files/get-storage.ts` (factory that reads env)

- [ ] **Step 1: Write `src/lib/files/get-storage.ts`**

```ts
import { LocalDiskStorage } from './storage';
import type { FileStorage } from './storage';

let cached: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (!cached) {
    const root = process.env.CAIRN_UPLOAD_ROOT ?? '/data/uploads';
    cached = new LocalDiskStorage(root);
  }
  return cached;
}
```

NOTE: env var `CAIRN_UPLOAD_ROOT` not in the main `env.ts` schema — it's an internal override mainly used by tests. Production uses the Docker volume default. If you want strict env parsing, add it to `src/lib/env.ts` schema.

- [ ] **Step 2: Write failing test `tests/api/upload.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';

let sql: ReturnType<typeof postgres>;
let uploadRoot = '';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  uploadRoot = await mkdtemp(join(tmpdir(), 'cairn-up-api-'));
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.CAIRN_UPLOAD_ROOT = uploadRoot;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(uploadRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(form: FormData) {
  const { POST } = await import('@/app/api/upload/route');
  const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('POST /api/upload', () => {
  it('editor can upload a png', async () => {
    await asUser('editor');
    const fd = new FormData();
    fd.set('file', new Blob([Buffer.from('PNG')], { type: 'image/png' }), 'a.png');
    const r = await call(fd);
    expect(r.status).toBe(201);
    expect((r.body as { signedUrl: string }).signedUrl).toMatch(/sig=/);
  });

  it('viewer is 403', async () => {
    await asUser('viewer');
    const fd = new FormData();
    fd.set('file', new Blob([Buffer.from('PNG')], { type: 'image/png' }), 'a.png');
    const r = await call(fd);
    expect(r.status).toBe(403);
  });

  it('rejects oversized files', async () => {
    await asUser('editor');
    process.env.CAIRN_MAX_UPLOAD_MB = '1';
    const fd = new FormData();
    // 2 MB blob
    fd.set('file', new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
    const r = await call(fd);
    expect(r.status).toBe(413);
    delete process.env.CAIRN_MAX_UPLOAD_MB;
  });

  it('rejects disallowed mime', async () => {
    await asUser('editor');
    const fd = new FormData();
    fd.set('file', new Blob([Buffer.from('x')], { type: 'application/x-msdownload' }), 'evil.exe');
    const r = await call(fd);
    expect(r.status).toBe(415);
  });
});
```

- [ ] **Step 3: Write `src/app/api/upload/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { storeUpload } from '@/lib/files/upload';
import { getStorage } from '@/lib/files/get-storage';

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing file field' }, { status: 400 });
    }
    const max = env().CAIRN_MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > max) {
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    }
    const body = Buffer.from(await file.arrayBuffer());
    try {
      const result = await storeUpload({
        db: getDb(),
        storage: getStorage(),
        secret: env().AUTH_SECRET,
        workspaceId: ctx.workspaceId,
        uploadedBy: ctx.userId,
        filename: file.name,
        mimeType: file.type,
        body,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (/mime/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 415 });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/upload.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/app/api/upload/route.ts src/lib/files/get-storage.ts tests/api/upload.test.ts && \
  git commit -m "feat: POST /api/upload (multipart, role + size + mime gates)"
```

---

## Task 6: GET /api/files/[fileId] (signed-URL streaming)

**Files:**
- Create: `src/app/api/files/[fileId]/route.ts`
- Create: `tests/api/files-get.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { getDb } from '@/db/client';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { storeUpload } from '@/lib/files/upload';
import { LocalDiskStorage } from '@/lib/files/storage';

let sql: ReturnType<typeof postgres>;
let uploadRoot = '';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  uploadRoot = await mkdtemp(join(tmpdir(), 'cairn-up-get-'));
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.CAIRN_UPLOAD_ROOT = uploadRoot;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(uploadRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function callGet(fileId: string, sig: string, exp: string) {
  const { GET } = await import('@/app/api/files/[fileId]/route');
  const res = await GET(
    new Request(`http://localhost/api/files/${fileId}?sig=${sig}&exp=${exp}`),
    { params: Promise.resolve({ fileId }) },
  );
  return res;
}

describe('GET /api/files/[fileId]', () => {
  it('returns the bytes with a valid signature', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const { file, signedUrl } = await storeUpload({
      db: getDb(),
      storage: new LocalDiskStorage(uploadRoot),
      secret: 'x'.repeat(32),
      workspaceId: u.workspaceId,
      uploadedBy: u.userId,
      filename: 'a.png',
      mimeType: 'image/png',
      body: Buffer.from('PIXELS'),
    });
    const url = new URL(signedUrl, 'http://localhost');
    const res = await callGet(file.id, url.searchParams.get('sig')!, url.searchParams.get('exp')!);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('PIXELS');
  });

  it('rejects missing signature with 401', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const { file } = await storeUpload({
      db: getDb(),
      storage: new LocalDiskStorage(uploadRoot),
      secret: 'x'.repeat(32),
      workspaceId: u.workspaceId,
      uploadedBy: u.userId,
      filename: 'b.png',
      mimeType: 'image/png',
      body: Buffer.from('x'),
    });
    const res = await callGet(file.id, 'deadbeef', String(Math.floor(Date.now() / 1000) + 60));
    expect(res.status).toBe(401);
  });

  it('404 for unknown file', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const res = await callGet('00000000-0000-0000-0000-000000000000', 'deadbeef', String(exp));
    expect([401, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Write `src/app/api/files/[fileId]/route.ts`**

```ts
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { getStorage } from '@/lib/files/get-storage';
import { verifyFileUrl } from '@/lib/files/signing';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await params;
  const url = new URL(req.url);
  const sig = url.searchParams.get('sig');
  const exp = Number(url.searchParams.get('exp'));
  if (!sig || !exp) return NextResponse.json({ error: 'missing signature' }, { status: 401 });

  const ok = verifyFileUrl({ fileId, expiresAt: exp, sig, secret: env().AUTH_SECRET });
  if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });

  const [f] = await getDb().select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
  if (!f) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // @ts-expect-error — Node Readable is web-compatible enough for Response in Next 15
  return new Response(getStorage().read(f.path), {
    status: 200,
    headers: {
      'content-type': f.mimeType,
      'content-length': String(f.size),
      'cache-control': 'private, max-age=300',
    },
  });
}
```

- [ ] **Step 3: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/files-get.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add 'src/app/api/files/' tests/api/files-get.test.ts && \
  git commit -m "feat: GET /api/files/:id with HMAC-verified streaming"
```

---

## Task 7: TipTap image extension + slash menu integration

**Goal:** A `customImage` node (we don't use `@tiptap/extension-image` directly because we need our `src` to be a signed URL, not a data URI).

**Files:**
- Create: `src/components/editor/image-extension.ts`
- Modify: `src/components/editor/extensions.ts`
- Modify: `src/components/editor/slash-extension.ts` (add Image item)

- [ ] **Step 1: Write the extension**

```ts
import { Node, mergeAttributes } from '@tiptap/core';

export const CairnImage = Node.create({
  name: 'cairnImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null as string | null },
      alt: { default: null as string | null },
      fileId: { default: null as string | null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-cairn-image]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-image': 'true',
        class: 'rounded-md max-w-full',
      }),
    ];
  },
  addCommands() {
    return {
      insertCairnImage:
        (attrs: { src: string; alt?: string; fileId?: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cairnImage: {
      insertCairnImage: (attrs: { src: string; alt?: string; fileId?: string }) => ReturnType;
    };
  }
}
```

- [ ] **Step 2: Wire into `extensions.ts`** — import + append to array.

- [ ] **Step 3: Add slash menu entry**

In `slash-extension.ts`, prepend or append a new `SlashItem`:

```ts
{
  title: 'Image',
  description: 'Upload and embed an image',
  command: (editor) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return;
      const { signedUrl, file: meta } = (await res.json()) as { signedUrl: string; file: { id: string; name: string } };
      editor.chain().focus().insertCairnImage({ src: signedUrl, alt: meta.name, fileId: meta.id }).run();
    };
    input.click();
  },
},
```

- [ ] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/editor/ && \
  git commit -m "feat: image block extension + slash menu entry"
```

---

## Task 8: TipTap file attachment extension

**Goal:** Non-image attachments render as a styled download link.

**Files:**
- Create: `src/components/editor/file-extension.ts`
- Modify: `src/components/editor/extensions.ts`
- Modify: `src/components/editor/slash-extension.ts` (File item)
- Modify: `src/components/editor/code-highlight.css` (file-block styles)

- [ ] **Step 1: Write the extension**

```ts
import { Node, mergeAttributes } from '@tiptap/core';

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null as string | null },
      name: { default: 'file' },
      mimeType: { default: 'application/octet-stream' },
      size: { default: 0 },
      fileId: { default: null as string | null },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-cairn-file]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-file': 'true',
        href: HTMLAttributes.href,
        class: 'file-attachment',
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
      HTMLAttributes.name as string,
    ];
  },
  addCommands() {
    return {
      insertFile:
        (attrs: { href: string; name: string; mimeType: string; size: number; fileId: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileAttachment: {
      insertFile: (attrs: {
        href: string;
        name: string;
        mimeType: string;
        size: number;
        fileId: string;
      }) => ReturnType;
    };
  }
}
```

- [ ] **Step 2: Wire into extensions, add slash item, add CSS**

In `code-highlight.css` append:

```css
.file-attachment {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  margin: 0.25rem 0;
  font-size: 0.875rem;
  text-decoration: none;
  color: hsl(var(--foreground));
}
.file-attachment::before {
  content: '📎';
  margin-right: 0.5rem;
}
```

Slash item (in `slash-extension.ts`):

```ts
{
  title: 'File',
  description: 'Attach a file as a downloadable link',
  command: (editor) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return;
      const { signedUrl, file: meta } = (await res.json()) as { signedUrl: string; file: { id: string; name: string; mimeType: string; size: number } };
      editor.chain().focus().insertFile({
        href: signedUrl,
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        fileId: meta.id,
      }).run();
    };
    input.click();
  },
},
```

- [ ] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/editor/ && \
  git commit -m "feat: file attachment block extension + slash menu entry"
```

---

## Task 9: Drag-drop + paste image upload in editor

**Goal:** Drop or paste an image in the editor → uploads + inserts an image block.

**Files:**
- Modify: `src/components/editor/editor.tsx`

- [ ] **Step 1: Add paste/drop handlers in `editor.tsx`**

Inside the `useEditor({ ... })` config, add `editorProps.handleDrop` and `editorProps.handlePaste`:

```ts
editorProps: {
  attributes: { /* unchanged */ },
  handleDrop(view, event, _slice, moved) {
    if (moved || !event.dataTransfer?.files?.length) return false;
    const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return false;
    event.preventDefault();
    void uploadAndInsert(files, view);
    return true;
  },
  handlePaste(view, event) {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return false;
    event.preventDefault();
    void uploadAndInsert(files, view);
    return true;
  },
},
```

`uploadAndInsert` is a local helper inside `Editor`:

```ts
async function uploadAndInsert(files: File[], view: { dispatch: (tr: unknown) => void }) {
  for (const file of files) {
    const fd = new FormData();
    fd.set('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) continue;
    const { signedUrl, file: meta } = (await res.json()) as { signedUrl: string; file: { id: string; name: string } };
    editor?.chain().focus().insertCairnImage({ src: signedUrl, alt: meta.name, fileId: meta.id }).run();
  }
}
```

(Adapt the helper to the actual closure scope; `editor` is the result of `useEditor`.)

- [ ] **Step 2: Build + test + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/editor/editor.tsx && \
  git commit -m "feat: editor drag-drop + paste image upload"
```

---

## Task 10: Cover image on page route

**Goal:** A cover banner at the top of `/pages/[pageId]`. Click to upload.

**Files:**
- Create: `src/components/cover-image.tsx`
- Modify: `src/app/(app)/pages/[pageId]/page.tsx`

- [ ] **Step 1: Write `src/components/cover-image.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CoverImage({ pageId, initial }: { pageId: string; initial: string | null }) {
  const [src, setSrc] = useState<string | null>(initial);

  async function upload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return;
      const { signedUrl } = (await res.json()) as { signedUrl: string };
      const patch = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: signedUrl }),
      });
      if (patch.ok) setSrc(signedUrl);
    };
    input.click();
  }

  async function remove() {
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ coverUrl: null }),
    });
    if (res.ok) setSrc(null);
  }

  if (!src) {
    return (
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={upload}>+ Add cover</Button>
      </div>
    );
  }
  return (
    <div className="group relative mb-6 h-48 overflow-hidden rounded-lg">
      <img src={src} alt="" className="h-full w-full object-cover" />
      <div className="absolute top-2 right-2 flex gap-2 opacity-0 transition group-hover:opacity-100">
        <Button variant="secondary" size="sm" onClick={upload}>Change</Button>
        <Button variant="secondary" size="sm" onClick={remove}>Remove</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `(app)/pages/[pageId]/page.tsx`**

Update the page view to include `<CoverImage pageId={page.id} initial={page.coverUrl} />` above the icon/title row.

Also update `src/app/api/pages/[pageId]/route.ts` PATCH schema to accept `coverUrl: z.string().nullable().optional()` and pass it through to `updatePage`. And update `src/lib/pages/update.ts` to handle the `coverUrl` patch field. Both edits should be minimal.

- [ ] **Step 3: Build + test + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/cover-image.tsx 'src/app/(app)/pages/[pageId]/page.tsx' \
        'src/app/api/pages/[pageId]/route.ts' src/lib/pages/update.ts && \
  git commit -m "feat: page cover image (upload + remove)"
```

---

## Task 11: Markdown export (ProseMirror JSON → md)

**Files:**
- Install: `prosemirror-markdown` (the basic-schema converter — we'll need to teach it our custom nodes)
- Create: `src/lib/markdown/from-prose.ts`
- Create: `tests/lib/markdown/round-trip.test.ts`

NOTE: `prosemirror-markdown` ships a `MarkdownSerializer` that knows the basic schema (paragraph, heading, bullet/ordered list, blockquote, code_block, horizontal_rule, image). We extend it with serializers for `callout`, `cairnImage`, `fileAttachment`, `taskList`, `taskItem`.

- [ ] **Step 1: Install**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add prosemirror-markdown@^1.13.0 prosemirror-model@^1.22.0
```

- [ ] **Step 2: Write `src/lib/markdown/from-prose.ts`**

```ts
import { defaultMarkdownSerializer, MarkdownSerializer } from 'prosemirror-markdown';
import { Node } from 'prosemirror-model';

// Extend the default serializer with handlers for our custom node types.
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    callout(state, node) {
      state.write(`> [!${(node.attrs.color as string) ?? 'default'}]\n`);
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
      state.closeBlock(node);
    },
    cairnImage(state, node) {
      const alt = (node.attrs.alt as string) ?? '';
      const src = (node.attrs.src as string) ?? '';
      state.write(`![${alt}](${src})`);
      state.closeBlock(node);
    },
    fileAttachment(state, node) {
      const name = (node.attrs.name as string) ?? 'file';
      const href = (node.attrs.href as string) ?? '';
      state.write(`[📎 ${name}](${href})`);
      state.closeBlock(node);
    },
    taskList(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    taskItem(state, node) {
      const checked = node.attrs.checked ? 'x' : ' ';
      state.write(`[${checked}] `);
      state.renderContent(node);
    },
  },
  defaultMarkdownSerializer.marks,
);

export function proseToMarkdown(doc: unknown): string {
  // We accept `doc` as plain ProseMirror JSON (parsed from our pages.content jsonb).
  // The serializer expects a `Node`; build it via Node.fromJSON with a minimal schema.
  // For Plan 4 we accept "best-effort" serialization — the schema definition exists
  // client-side via TipTap. Here we construct a Node from raw JSON using a permissive
  // schema. If a node type isn't recognized, default serializer falls back to plaintext.
  const node = Node.fromJSON({} as never, doc as never); // see NOTE below
  return serializer.serialize(node);
}
```

NOTE: `Node.fromJSON` requires a `Schema`. For server-side serialization we either:
- Recreate the same schema TipTap uses (duplicates extension config).
- Use a minimal permissive schema accepting any node type.

Use option B with a small custom schema that mirrors our editor's node names. Add to `from-prose.ts` a `cairnSchema` built from prosemirror-model.

Given complexity, an alternative approach: serialize the JSON tree directly without going through `Node.fromJSON`. Write a custom recursive serializer keyed on `node.type` strings. That avoids the schema-recreation problem entirely.

REVISED Step 2: write a JSON-walker serializer:

```ts
type Doc = { type: string; content?: Doc[]; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[] };

export function proseToMarkdown(doc: unknown): string {
  return renderNode(doc as Doc, 0).trim() + '\n';
}

function renderNode(node: Doc, depth: number): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((c) => renderNode(c, depth)).join('\n\n');
    case 'paragraph':
      return renderInline(node);
    case 'heading': {
      const level = Math.min(Math.max((node.attrs?.level as number) ?? 1, 1), 6);
      return `${'#'.repeat(level)} ${renderInline(node)}`;
    }
    case 'bulletList':
      return (node.content ?? []).map((li) => `- ${renderNode(li, depth + 1)}`).join('\n');
    case 'orderedList':
      return (node.content ?? []).map((li, i) => `${i + 1}. ${renderNode(li, depth + 1)}`).join('\n');
    case 'listItem':
      return (node.content ?? []).map((c) => renderNode(c, depth)).join('\n');
    case 'taskList':
      return (node.content ?? []).map((li) => renderNode(li, depth + 1)).join('\n');
    case 'taskItem': {
      const checked = (node.attrs?.checked as boolean) ? 'x' : ' ';
      const inner = (node.content ?? []).map((c) => renderInline(c)).join(' ');
      return `- [${checked}] ${inner}`;
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((c) => renderNode(c, depth))
        .join('\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    case 'callout': {
      const color = (node.attrs?.color as string) ?? 'default';
      const inner = (node.content ?? [])
        .map((c) => renderNode(c, depth))
        .join('\n');
      const body = inner.split('\n').map((l) => `> ${l}`).join('\n');
      return `> [!${color}]\n${body}`;
    }
    case 'cairnImage':
      return `![${(node.attrs?.alt as string) ?? ''}](${(node.attrs?.src as string) ?? ''})`;
    case 'fileAttachment':
      return `[📎 ${(node.attrs?.name as string) ?? 'file'}](${(node.attrs?.href as string) ?? ''})`;
    default:
      return renderInline(node);
  }
}

function renderInline(node: Doc): string {
  if (node.type === 'text') {
    let text = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`;
      else if (mark.type === 'italic') text = `*${text}*`;
      else if (mark.type === 'code') text = `\`${text}\``;
      else if (mark.type === 'strike') text = `~~${text}~~`;
      else if (mark.type === 'link') text = `[${text}](${(mark.attrs?.href as string) ?? ''})`;
    }
    return text;
  }
  return (node.content ?? []).map((c) => renderInline(c)).join('');
}
```

This bypasses prosemirror-model entirely. Simpler.

- [ ] **Step 3: Write `tests/lib/markdown/round-trip.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { proseToMarkdown } from '@/lib/markdown/from-prose';

describe('proseToMarkdown', () => {
  it('renders a paragraph', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
    expect(out.trim()).toBe('hello');
  });

  it('renders a heading', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }],
    });
    expect(out.trim()).toBe('## Title');
  });

  it('renders bullet list', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        },
      ],
    });
    expect(out.trim()).toBe('- A\n- B');
  });

  it('renders code block with language', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    });
    expect(out.trim()).toBe('```ts\nconst x = 1;\n```');
  });

  it('renders bold + italic marks', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'B', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    });
    expect(out.trim()).toBe('**A** *B*');
  });

  it('renders image as ![alt](src)', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [{ type: 'cairnImage', attrs: { alt: 'cat', src: '/api/files/x' } }],
    });
    expect(out.trim()).toBe('![cat](/api/files/x)');
  });
});
```

- [ ] **Step 4: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/markdown/round-trip.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/markdown/ tests/lib/markdown/round-trip.test.ts package.json pnpm-lock.yaml && \
  git commit -m "feat: ProseMirror JSON → markdown serializer (proseToMarkdown)"
```

---

## Task 12: Markdown import (md → ProseMirror JSON)

**Goal:** Parse a markdown string into ProseMirror JSON that matches our editor schema.

**Files:**
- Install: `marked` (markdown lexer)
- Create: `src/lib/markdown/to-prose.ts`
- Add cases to `tests/lib/markdown/round-trip.test.ts`

- [ ] **Step 1: Install**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add marked@^14.1.0
```

- [ ] **Step 2: Write `src/lib/markdown/to-prose.ts`**

Use `marked.lexer(md)` to get tokens, then convert each to our node JSON. Implementation below covers the v0.1.0 block set; mark conversion handled minimally.

```ts
import { marked } from 'marked';

type Doc = { type: string; content?: Doc[]; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[] };

export function markdownToProse(md: string): Doc {
  const tokens = marked.lexer(md);
  const blocks: Doc[] = tokens.map(tokenToBlock).filter((b): b is Doc => b !== null);
  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}

function tokenToBlock(t: marked.Token): Doc | null {
  switch (t.type) {
    case 'heading':
      return { type: 'heading', attrs: { level: Math.min(t.depth, 3) }, content: inlineFromText(t.text) };
    case 'paragraph':
      return { type: 'paragraph', content: inlineFromText(t.text) };
    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: t.lang ?? '' },
        content: [{ type: 'text', text: t.text }],
      };
    case 'blockquote':
      return {
        type: 'blockquote',
        content: (t.tokens ?? []).map(tokenToBlock).filter((x): x is Doc => x !== null),
      };
    case 'list': {
      const listType = t.ordered ? 'orderedList' : 'bulletList';
      const items: Doc[] = t.items.map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inlineFromText(item.text) }],
      }));
      return { type: listType, content: items };
    }
    case 'hr':
      return { type: 'horizontalRule' };
    case 'space':
      return null;
    default:
      return { type: 'paragraph', content: inlineFromText((t as { raw?: string }).raw ?? '') };
  }
}

function inlineFromText(text: string): Doc[] {
  // Best-effort: support **bold**, *italic*, `code`, [link](href).
  // Anything else passes through as plain text. Full mark fidelity is deferred.
  return [{ type: 'text', text }];
}
```

NOTE: `inlineFromText` is intentionally minimal — Plan 4's import is "good enough to round-trip simple markdown into editable blocks." A future enhancement can parse inline tokens via `marked.lexer.inline()` and build mark spans. For v0.1.0 we accept plaintext-flatten-with-marks-stripped behavior, with the block structure preserved.

- [ ] **Step 3: Add tests**

```ts
import { markdownToProse } from '@/lib/markdown/to-prose';

// ...
it('imports H1 + paragraph', () => {
  const doc = markdownToProse('# Title\n\nSome text');
  expect(doc.content?.[0]?.type).toBe('heading');
  expect(doc.content?.[1]?.type).toBe('paragraph');
});

it('imports a code block with language', () => {
  const doc = markdownToProse('```ts\nconst x = 1;\n```');
  expect(doc.content?.[0]).toMatchObject({
    type: 'codeBlock',
    attrs: { language: 'ts' },
  });
});

it('imports a bullet list', () => {
  const doc = markdownToProse('- A\n- B');
  expect(doc.content?.[0]?.type).toBe('bulletList');
});
```

- [ ] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/markdown/round-trip.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/markdown/to-prose.ts tests/lib/markdown/round-trip.test.ts package.json pnpm-lock.yaml && \
  git commit -m "feat: markdownToProse (md → ProseMirror JSON, blocks only)"
```

---

## Task 13: GET /api/pages/[id]/export (single + zip)

**Goal:** Export one page as `.md`, or a subtree as `.zip`.

**Files:**
- Create: `src/app/api/pages/[pageId]/export/route.ts`
- Create: `src/lib/markdown/export-subtree.ts`
- Create: `tests/api/pages-export.test.ts`
- Install: `archiver`

- [ ] **Step 1: Install archiver**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add archiver@^7.0.1 && pnpm add -D @types/archiver
```

- [ ] **Step 2: Write `src/lib/markdown/export-subtree.ts`**

```ts
import { Readable, PassThrough } from 'node:stream';
import archiver from 'archiver';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { proseToMarkdown } from './from-prose';

export async function streamSubtreeZip(
  db: PostgresJsDatabase<typeof schema>,
  args: { workspaceId: string; rootPageId: string },
): Promise<Readable> {
  // Fetch root + all live descendants.
  const pages = await fetchSubtree(db, args);
  const pass = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(pass);
  for (const p of pages) {
    const md = proseToMarkdown(p.content);
    const filename = `${slug(p.title)}-${p.id.slice(0, 8)}.md`;
    archive.append(md, { name: filename });
  }
  void archive.finalize();
  return pass;
}

async function fetchSubtree(
  db: PostgresJsDatabase<typeof schema>,
  args: { workspaceId: string; rootPageId: string },
) {
  // Recursive walk
  const sqlText = /* sql */ `
    WITH RECURSIVE tree AS (
      SELECT id, title, content FROM pages
      WHERE workspace_id = '${args.workspaceId}' AND id = '${args.rootPageId}' AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.title, p.content FROM pages p
      INNER JOIN tree t ON p.parent_id = t.id
      WHERE p.workspace_id = '${args.workspaceId}' AND p.deleted_at IS NULL
    )
    SELECT id, title, content FROM tree;
  `;
  // NOTE: using string interpolation here because the recursive CTE makes
  // parameterized binding awkward. workspaceId and rootPageId are UUIDs
  // validated upstream by Zod. Treat this as the only place that pattern
  // is acceptable.
  const rows = (await db.execute({ queryChunks: [sqlText] } as never)) as unknown as {
    id: string; title: string; content: unknown;
  }[];
  return rows;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'untitled';
}
```

NOTE: the `db.execute({queryChunks: [sqlText]} as never)` is hacky. Cleaner: use `import { sql as rawSql } from 'drizzle-orm';` and `rawSql.raw(sqlText)` with bound parameters via the template form. The implementer should iterate on this until it compiles cleanly:

```ts
const rows = (await db.execute(rawSql`
  WITH RECURSIVE tree AS (
    SELECT id, title, content FROM pages
    WHERE workspace_id = ${args.workspaceId}::uuid AND id = ${args.rootPageId}::uuid AND deleted_at IS NULL
    UNION ALL
    SELECT p.id, p.title, p.content FROM pages p
    INNER JOIN tree t ON p.parent_id = t.id
    WHERE p.workspace_id = ${args.workspaceId}::uuid AND p.deleted_at IS NULL
  )
  SELECT id, title, content FROM tree;
`)) as unknown as { id: string; title: string; content: unknown }[];
```

That's safer and matches Plan 2's pattern.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/pages/[pageId]/export/route.ts
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requirePageAccess } from '@/lib/pages/access';
import { proseToMarkdown } from '@/lib/markdown/from-prose';
import { streamSubtreeZip } from '@/lib/markdown/export-subtree';
import { HttpError } from '@/lib/auth/require-role';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'viewer');
    const url = new URL(req.url);
    const recursive = url.searchParams.get('recursive') === 'true';

    if (recursive) {
      const stream = await streamSubtreeZip(getDb(), {
        workspaceId: ctx.workspaceId,
        rootPageId: page.id,
      });
      // @ts-expect-error: Node Readable → web Response
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${page.title || 'export'}.zip"`,
        },
      });
    }

    const md = proseToMarkdown(page.content);
    return new Response(md, {
      status: 200,
      headers: {
        'content-type': 'text/markdown',
        'content-disposition': `attachment; filename="${page.title || 'page'}.md"`,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Test (subset — verify response shape)**

```ts
// tests/api/pages-export.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';

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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

describe('GET /api/pages/[id]/export', () => {
  it('returns the page as markdown', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId, title: 'X' });
    await updatePage(getDb(), {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] }],
        },
      },
    });
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(
      new Request(`http://localhost/api/pages/${p.id}/export`),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('markdown');
    const text = await res.text();
    expect(text).toContain('# H');
  });

  it('returns a zip for recursive=true', async () => {
    const u = await asUser('viewer');
    const root = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Root' });
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

- [ ] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-export.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/markdown/export-subtree.ts 'src/app/api/pages/[pageId]/export/' tests/api/pages-export.test.ts \
        package.json pnpm-lock.yaml && \
  git commit -m "feat: page export as markdown (single .md or subtree .zip)"
```

---

## Task 14: POST /api/pages/[id]/import

**Goal:** Replace page content with parsed markdown.

**Files:**
- Create: `src/app/api/pages/[pageId]/import/route.ts`
- Create: `tests/api/pages-import.test.ts`

- [ ] **Step 1: Route**

```ts
// src/app/api/pages/[pageId]/import/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requirePageAccess } from '@/lib/pages/access';
import { updatePage } from '@/lib/pages/update';
import { markdownToProse } from '@/lib/markdown/to-prose';
import { HttpError } from '@/lib/auth/require-role';

const Input = z.object({ markdown: z.string().max(5_000_000) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const { markdown } = Input.parse(await req.json());
    const content = markdownToProse(markdown);
    const updated = await updatePage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      patch: { content },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Test**

```ts
// tests/api/pages-import.test.ts (skeleton — fill in similar to pages-export.test.ts)
// 3 cases: editor 200 + content updated; viewer 403; bad input 400
```

- [ ] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-import.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add 'src/app/api/pages/[pageId]/import/' tests/api/pages-import.test.ts && \
  git commit -m "feat: POST /api/pages/:id/import (markdown → page content)"
```

---

## Task 15: Editor paste-markdown handler

**Goal:** Pasting raw markdown text into the editor converts to blocks (best-effort).

Detection: if the pasted text contains markdown-specific syntax (headings, lists, code fences) AND has more than one line, treat as markdown. Otherwise pass through normally.

**Files:**
- Modify: `src/components/editor/editor.tsx` (extend `handlePaste`)

- [ ] **Step 1: Add detection + conversion**

```ts
handlePaste(view, event) {
  // Images path (existing) ...

  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (looksLikeMarkdown(text)) {
    event.preventDefault();
    void import('@/lib/markdown/to-prose').then(({ markdownToProse }) => {
      const doc = markdownToProse(text);
      if (doc.content && doc.content.length > 0) {
        editor?.chain().focus().insertContent(doc.content).run();
      }
    });
    return true;
  }
  return false;
},

// helper somewhere above:
function looksLikeMarkdown(text: string): boolean {
  if (!text.includes('\n')) return false;
  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|---$)/m.test(text);
}
```

- [ ] **Step 2: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/editor/editor.tsx && \
  git commit -m "feat: paste-markdown handler converts pasted text to blocks"
```

---

## Task 16: Page menu (Export · Import) + UI polish

**Goal:** A small overflow menu on `/pages/[id]` with Export-as-md, Export-subtree-as-zip, Import-markdown actions.

**Files:**
- Create: `src/components/page-menu.tsx`
- Modify: `src/app/(app)/pages/[pageId]/page.tsx`

- [ ] **Step 1: Write `src/components/page-menu.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PageMenu({ pageId, title }: { pageId: string; title: string }) {
  const [open, setOpen] = useState(false);

  function download(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.click();
  }

  async function importMd() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,text/markdown,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await fetch(`/api/pages/${pageId}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: text }),
      });
      window.location.reload();
    };
    input.click();
  }

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover py-1 shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => download(`/api/pages/${pageId}/export`)}
          >
            Export as .md
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => download(`/api/pages/${pageId}/export?recursive=true`)}
          >
            Export subtree as .zip
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={importMd}
          >
            Import markdown…
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add to page route**

Mount `<PageMenu pageId={page.id} title={page.title} />` in the header row alongside title/icon.

- [ ] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/page-menu.tsx 'src/app/(app)/pages/[pageId]/page.tsx' && \
  git commit -m "feat: page overflow menu with export/import actions"
```

---

## Task 17: E2E smoke + CHANGELOG

- [ ] **Step 1: Smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  docker compose down -v 2>/dev/null || true && \
  docker compose up -d --build && \
  sleep 20
```

In a browser (or via curl + a Playwright script):
1. Sign up.
2. Create a page; paste an image into the editor → uploads + renders.
3. Pick a cover image; refresh — cover persists.
4. Click ⋯ → Export as .md → download a file containing the page's markdown.
5. Click ⋯ → Import markdown… → choose a `.md` file; page content replaces with the imported blocks.
6. Click ⋯ → Export subtree as .zip → download a zip containing every page in the subtree.

- [ ] **Step 2: CHANGELOG**

Add under `[Unreleased]`:

```markdown
### Added (Plan 4 — Files & markdown)
- `files` table, `pages.cover_url` column, signed file URL helpers.
- `POST /api/upload` (role+size+mime gated) and `GET /api/files/[id]?sig=&exp=` (HMAC-streamed).
- Image and file attachment blocks in the editor; drag/drop + paste image support.
- Cover image picker on the page route.
- Markdown export per page (`.md`) and per subtree (`.zip`).
- Markdown import via overflow menu and via pasting raw markdown into the editor.
```

- [ ] **Step 3: Tear down + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && docker compose down
git add CHANGELOG.md && git commit -m "docs: changelog entry for files & markdown (Plan 4)"
```

---

## Done

After this plan: users can attach files and images, set page covers, and round-trip markdown. **Next plan:** `2026-MM-DD-cairn-databases.md` — inline database blocks with table, kanban, gallery views.
