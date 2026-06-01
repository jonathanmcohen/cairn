# v0.9.8 G4 — Live refetch + orphan sweep (audit items G, H)

**For agentic workers:** REQUIRED SUB-SKILL — before executing any task in this plan you MUST load and follow `superpowers:test-driven-development` (write the failing test first, watch it fail, write the minimal implementation, watch it pass, then commit). Every task below is structured as explicit TDD steps; do not skip the run-to-fail step.

**Goal:** Close the two genuinely-new G4 audit items from the v0.9.7 browser audit:
- **(G) Live refetch gaps.** Three client mutations update local React state but never call `router.refresh()`, so server-rendered surfaces that derive from the same data (sidebar counts/badges/ordering, the notification bell badge, favorites ordering on next SSR) go stale until a manual reload. Add `router.refresh()` to: comment-add (`comment-panel.tsx`), favorites-reorder (`sidebar-favorites.tsx`), and notification mark-read (`notifications/page-list.tsx` + `notifications/drawer.tsx`). Add a Playwright e2e proving a freshly-created page appears in the sidebar tree within 1s with no manual reload.
- **(H) Orphan-empty-Untitled CLI sweep.** A net-new `pages:purge-orphans` CLI subcommand (mirroring the shipped `pages:auto-unlock` precedent) that soft-deletes pages that are simultaneously `title='Untitled'`, `content_text=''`, not already trashed (`deleted_at IS NULL`), childless (no row references them via `parent_id`), and older than a `--older-than` threshold (default 30 days). `--dry-run` lists candidates without mutating. A lib helper `src/lib/pages/orphan-purge-cli.ts` holds the pure logic; a Testcontainers test pins the selection query.

**Architecture:**
- **Refetch model:** the app uses Next App Router server components + `router.refresh()` (`next/navigation`) to re-run the server render, **NOT** TanStack Query. The page tree is server-rendered from `src/lib/pages/tree.ts#flattenedPageTree`; the notification bell badge and the favorites order are likewise SSR. Mutations that change those server-derived surfaces must call `router.refresh()` after a successful response so the still-mounted server tree re-fetches. Precedents already doing this: `use-page-row-actions.tsx` (create/duplicate/rename/trash), `trash-list.tsx` (restore/delete), `sidebar-favorites.tsx` `onRemove` (line 93), `new-page-button.tsx` (push-then-refresh).
- **CLI model:** `src/server/cli.ts` is the entrypoint-bundled CLI runner. Subcommands are parsed by `src/server/cli-internal.ts#parseArgs` (a closed `KNOWN_COMMANDS` union) and dispatched by `main()`. Each subcommand dynamically imports a pure lib helper under `src/lib/**/<feature>-cli.ts` that opens its own `postgres()` connection from `DATABASE_URL`, runs a pure function, and closes the pool. `recordCliAudit(conn, action, metadata)` (line 184) writes a best-effort structured stdout audit line. The precedent to mirror exactly is `pages:auto-unlock` (`cli.ts:423-428`, `src/lib/pages/auto-unlock-cli.ts`, `src/lib/pages/auto-unlock.ts`).
- **Schema (no migration):** `src/db/schema/pages.ts` already has every column the sweep reads — `title` (default `'Untitled'`, line 39), `contentText` → `content_text` (default `''`, line 73), `parentId` → `parent_id` (self-FK, line 38), `deletedAt` → `deleted_at` (line 84), `createdAt` → `created_at` (line 82). Item H reads existing columns only; **no migration**.

**Tech Stack:** Next.js 16 App Router + React 19, TypeScript 6 strict, Drizzle ORM + Postgres (postgres-js driver), Biome v2 (lint+format), Vitest 4 + Testcontainers v12 (real Postgres 18 image), Playwright (a11y/e2e harness in `tests/a11y`, `testMatch: '**/*.spec.ts'`), i18n en/es/ar via `useT()`. All shell commands MUST be prefixed with `source ~/.zshenv && ` (Homebrew/node/pnpm/docker are not on PATH otherwise, and `~/.zshenv` sets `DOCKER_HOST`/`TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` for Colima).

---

## Task 1 — comment-add calls `router.refresh()`

Adding a comment increments the page's server-rendered comment count / badge. Today `addComment` only appends to local `comments` state. Add a `router.refresh()` after a successful POST so SSR surfaces stay consistent. No new user-facing strings.

### Files
- **Modify** `src/components/comments/comment-panel.tsx` — import `useRouter` from `next/navigation`, take a `router` ref in the component, and call `router.refresh()` at the end of `addComment` (currently lines 89-107; the `setComments(...)` append is at line 105).
- **Create** `tests/components/comment-panel-refresh.test.tsx` — jsdom component test asserting `router.refresh` fires after a successful add.

### Steps

1. **Write the failing test.** Create `tests/components/comment-panel-refresh.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '@/components/comments/comment-panel';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

beforeEach(() => {
  refresh.mockClear();
  vi.restoreAllMocks();
});

describe('<CommentPanel> live refetch', () => {
  it('calls router.refresh() after a comment is added', async () => {
    const created = {
      id: 'c1',
      pageId: 'p1',
      authorId: 'u1',
      body: 'hello',
      anchor: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // initial refetch on open → empty list
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // POST add → created comment
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));

    render(
      <CommentPanel
        pageId="p1"
        canComment
        currentUserId="u1"
        currentRole="editor"
        open
        onClose={() => {}}
      />,
    );

    // Wait for the open-time refetch to resolve.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const textarea = screen.getByPlaceholderText('pageActions.comments.placeholder');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('pageActions.comments.submit'));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
```

2. **Run it to confirm it fails.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/comment-panel-refresh.test.tsx
```

Expected: FAIL — `expect(refresh).toHaveBeenCalledTimes(1)` times out (received 0), because `addComment` never calls `router.refresh()`.

3. **Minimal implementation.** Edit `src/components/comments/comment-panel.tsx`.

Add the import (alongside the existing `react` import at line 4):

```tsx
import { useRouter } from 'next/navigation';
```

Inside the component body, add the router ref right after `const t = useT();` (line 66):

```tsx
  const t = useT();
  const router = useRouter();
```

Append the refresh at the end of `addComment`, after the existing `setDraft('')` (currently line 106):

```tsx
    const created = (await res.json()) as Comment;
    setComments((prev) => [...prev, created]);
    setDraft('');
    // v0.9.8 G4 (G) — the page's server-rendered comment count/badge derives
    // from the same data; re-run the server tree so it stays consistent.
    router.refresh();
```

4. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/comment-panel-refresh.test.tsx
```

Expected: PASS (1 passed).

5. **Commit.**

```sh
git add src/components/comments/comment-panel.tsx tests/components/comment-panel-refresh.test.tsx && git commit -m "fix(comments): refresh server tree after comment add (G4 G)"
```

---

## Task 2 — favorites-reorder calls `router.refresh()`

Reordering favorites POSTs the new order to `/api/favorites/reorder` but never refreshes; the next SSR of the sidebar therefore renders the stale order. `onRemove` already refreshes (line 93). Add `router.refresh()` to `postOrder` after a successful POST. No new user-facing strings.

### Files
- **Modify** `src/components/sidebar-favorites.tsx` — `postOrder` (lines 42-49) currently fires the POST and discards the result. Make it `await` the response and `router.refresh()` on success. `router` is already in scope (line 35), but `postOrder`'s dependency array (line 49) must add `router`.
- **Create** `tests/components/sidebar-favorites-refresh.test.tsx` — jsdom test asserting keyboard reorder triggers `router.refresh()`.

### Steps

1. **Write the failing test.** Create `tests/components/sidebar-favorites-refresh.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarFavorites } from '@/components/sidebar-favorites';
import type { PrefEntry } from '@/lib/prefs/user-page-prefs';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }));

afterEach(cleanup);

beforeEach(() => {
  refresh.mockClear();
  vi.restoreAllMocks();
});

const FAVS: PrefEntry[] = [
  { id: 'f1', pageId: 'p1', title: 'Alpha', icon: null },
  { id: 'f2', pageId: 'p2', title: 'Beta', icon: null },
];

describe('<SidebarFavorites> live refetch', () => {
  it('calls router.refresh() after a keyboard reorder persists', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    render(<SidebarFavorites favorites={FAVS} />);

    // ArrowDown on the first row moves it down and persists the new order.
    const firstRow = screen.getByText('Alpha').closest('li');
    if (!firstRow) throw new Error('first favorites row not found');
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
```

2. **Run it to confirm it fails.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/sidebar-favorites-refresh.test.tsx
```

Expected: FAIL — `expect(refresh).toHaveBeenCalledTimes(1)` times out (received 0); `postOrder` never refreshes.

3. **Minimal implementation.** Edit `src/components/sidebar-favorites.tsx`. Replace the `postOrder` callback (lines 42-49):

```tsx
  const postOrder = useCallback(async (orderedFavoriteIds: string[]) => {
    await fetch('/api/favorites/reorder', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedFavoriteIds }),
    });
  }, []);
```

with:

```tsx
  const postOrder = useCallback(
    async (orderedFavoriteIds: string[]) => {
      const res = await fetch('/api/favorites/reorder', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedFavoriteIds }),
      });
      // v0.9.8 G4 (G) — the favorites order is server-rendered; re-run the
      // server tree so the persisted order survives the next SSR (e.g. on
      // navigation) instead of only living in local React state.
      if (res.ok) router.refresh();
    },
    [router],
  );
```

4. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/sidebar-favorites-refresh.test.tsx
```

Expected: PASS (1 passed).

5. **Commit.**

```sh
git add src/components/sidebar-favorites.tsx tests/components/sidebar-favorites-refresh.test.tsx && git commit -m "fix(favorites): refresh server tree after reorder persists (G4 G)"
```

---

## Task 3 — notification mark-read calls `router.refresh()` (page-list + drawer)

Marking a notification read decrements the server-rendered bell badge. Both the `/notifications` page list (`page-list.tsx#onMarkRead`, line 143) and the bell drawer (`drawer.tsx#onMarkRead` line 124, `onMarkAllRead` line 135) update only local/SWR state. Add `router.refresh()` after a successful mark so the SSR bell badge stays consistent. The drawer already calls an optional `onMarked?.()` callback, but that is owned by the bell wrapper and does not re-run the server render; we add an explicit `router.refresh()`. No new user-facing strings.

### Files
- **Modify** `src/components/notifications/page-list.tsx` — `router` already in scope (line 97); add `router.refresh()` at the end of `onMarkRead` (lines 143-152) and add `router` to its dependency array (line 152).
- **Modify** `src/components/notifications/drawer.tsx` — import `useRouter` from `next/navigation`, take a `router` ref, call `router.refresh()` at the end of both `onMarkRead` (lines 124-133) and `onMarkAllRead` (lines 135-144).
- **Create** `tests/components/notifications-mark-read-refresh.test.tsx` — jsdom test asserting both surfaces refresh.

### Steps

1. **Write the failing test.** Create `tests/components/notifications-mark-read-refresh.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDrawer } from '@/components/notifications/drawer';
import { NotificationsPageList } from '@/components/notifications/page-list';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: () => {}, push: () => {} }),
  usePathname: () => '/notifications',
}));

afterEach(cleanup);

beforeEach(() => {
  refresh.mockClear();
  vi.restoreAllMocks();
});

const NOTIF = {
  id: 'n1',
  type: 'mention' as const,
  payload: { pageId: 'p1' },
  readAt: null,
  createdAt: new Date().toISOString(),
};

describe('notifications mark-read live refetch', () => {
  it('page-list onMarkRead refreshes the server bell badge', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(
      <NotificationsPageList
        initial={{ notifications: [NOTIF], nextCursor: null }}
        initialFilter={{}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mark as read'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('drawer onMarkRead refreshes the server bell badge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/read')) return new Response(null, { status: 200 });
      // SWR feed fetch.
      return new Response(JSON.stringify({ notifications: [NOTIF], unreadCount: 1 }), {
        status: 200,
      });
    });

    render(<NotificationDrawer open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Mark as read')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Mark as read'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
```

2. **Run it to confirm it fails.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/notifications-mark-read-refresh.test.tsx
```

Expected: FAIL — both cases time out on `expect(refresh).toHaveBeenCalledTimes(1)` (received 0); neither `onMarkRead` refreshes.

3. **Minimal implementation — page-list.** Edit `src/components/notifications/page-list.tsx`. Replace `onMarkRead` (lines 143-152):

```tsx
  const onMarkRead = useCallback(async (id: string) => {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return;
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
  }, []);
```

with:

```tsx
  const onMarkRead = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      // v0.9.8 G4 (G) — the server-rendered unread bell badge derives from the
      // same rows; re-run the server tree so it decrements without a reload.
      router.refresh();
    },
    [router],
  );
```

4. **Minimal implementation — drawer.** Edit `src/components/notifications/drawer.tsx`.

Add the import (next to the existing `useEffect`/`useId`/`useState` import at line 6):

```tsx
import { useRouter } from 'next/navigation';
```

Add the router ref inside the component, after `const titleId = useId();` (line 87):

```tsx
  const titleId = useId();
  const router = useRouter();
```

Append `router.refresh()` inside `onMarkRead` (after `onMarked?.();`, line 129) and inside `onMarkAllRead` (after `onMarked?.();`, line 140):

```tsx
  async function onMarkRead(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' });
      await mutate();
      onMarked?.();
      // v0.9.8 G4 (G) — refresh the server-rendered bell badge.
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onMarkAllRead() {
    setMarkingAll(true);
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'POST', credentials: 'include' });
      await mutate();
      onMarked?.();
      // v0.9.8 G4 (G) — refresh the server-rendered bell badge.
      router.refresh();
    } finally {
      setMarkingAll(false);
    }
  }
```

5. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/notifications-mark-read-refresh.test.tsx
```

Expected: PASS (2 passed).

6. **Commit.**

```sh
git add src/components/notifications/page-list.tsx src/components/notifications/drawer.tsx tests/components/notifications-mark-read-refresh.test.tsx && git commit -m "fix(notifications): refresh server bell badge on mark-read (G4 G)"
```

---

## Task 4 — `orphanPurgeCandidates` + `runOrphanPurge` selection query (Testcontainers)

Net-new pure helper holding the orphan-empty-Untitled selection and the soft-delete. Mirrors `src/lib/pages/auto-unlock.ts` (a pure function taking a Drizzle db) so it is testable without spawning a child process. The selection is the spec's exact predicate:

```
title = 'Untitled' AND content_text = '' AND deleted_at IS NULL
  AND id NOT IN (SELECT parent_id FROM pages WHERE parent_id IS NOT NULL)
  AND created_at < now() - (<olderThanDays> || ' days')::interval
```

`runOrphanPurge(db, { olderThanDays, dryRun })` returns `{ candidates: Array<{ pageId, workspaceId }>, purgedCount }`. `dryRun` selects but does not write; default soft-deletes by setting `deleted_at = now()`.

### Files
- **Create** `src/lib/pages/orphan-purge.ts` — pure `runOrphanPurge` + `OrphanPurgeResult` type.
- **Create** `tests/lib/pages/orphan-purge.test.ts` — Testcontainers test pinning the selection (dry-run lists, default soft-deletes, all four exclusions hold, age threshold respected).

### Steps

1. **Write the failing test.** Create `tests/lib/pages/orphan-purge.test.ts`:

```ts
import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { runOrphanPurge } from '@/lib/pages/orphan-purge';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

/** Force a page's created_at into the past so it clears the age threshold. */
async function agePage(pageId: string, daysAgo: number): Promise<void> {
  await db.execute(drizzleSql`
    UPDATE pages SET created_at = now() - (${daysAgo}::text || ' days')::interval
     WHERE id = ${pageId}
  `);
}

async function seedWs() {
  return createTestWorkspaceWithUser(db, { role: 'owner' });
}

describe('runOrphanPurge', () => {
  it('dry-run lists an aged orphan-empty-Untitled page without deleting it', async () => {
    const ws = await seedWs();
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await agePage(orphan.id, 60);

    const result = await runOrphanPurge(db, { olderThanDays: 30, dryRun: true });
    expect(result.purgedCount).toBe(0);
    expect(result.candidates.map((c) => c.pageId)).toEqual([orphan.id]);

    const [row] = (await db.execute(drizzleSql`
      SELECT deleted_at FROM pages WHERE id = ${orphan.id}
    `)) as unknown as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at).toBeNull();
  });

  it('soft-deletes an aged orphan by default (sets deleted_at)', async () => {
    const ws = await seedWs();
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await agePage(orphan.id, 60);

    const result = await runOrphanPurge(db, { olderThanDays: 30, dryRun: false });
    expect(result.purgedCount).toBe(1);
    expect(result.candidates.map((c) => c.pageId)).toEqual([orphan.id]);

    const [row] = (await db.execute(drizzleSql`
      SELECT deleted_at FROM pages WHERE id = ${orphan.id}
    `)) as unknown as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('excludes titled, non-empty, already-trashed, parent, and too-new pages', async () => {
    const ws = await seedWs();

    // (a) titled — not 'Untitled'
    const titled = await createPage(db, {
      workspaceId: ws.workspaceId,
      createdBy: ws.userId,
      title: 'Keep me',
    });
    await agePage(titled.id, 60);

    // (b) non-empty content_text
    const nonEmpty = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db.update(schema.pages).set({ contentText: 'words' }).where(eq(schema.pages.id, nonEmpty.id));
    await agePage(nonEmpty.id, 60);

    // (c) already trashed
    const trashed = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db.update(schema.pages).set({ deletedAt: new Date() }).where(eq(schema.pages.id, trashed.id));
    await agePage(trashed.id, 60);

    // (d) parent of a child — empty/Untitled but referenced via parent_id
    const parent = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await createPage(db, {
      workspaceId: ws.workspaceId,
      createdBy: ws.userId,
      parentId: parent.id,
      title: 'child',
    });
    await agePage(parent.id, 60);

    // (e) too new — orphan-empty-Untitled but created today
    const tooNew = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });

    const result = await runOrphanPurge(db, { olderThanDays: 30, dryRun: true });
    const ids = result.candidates.map((c) => c.pageId);
    expect(ids).not.toContain(titled.id);
    expect(ids).not.toContain(nonEmpty.id);
    expect(ids).not.toContain(trashed.id);
    expect(ids).not.toContain(parent.id);
    expect(ids).not.toContain(tooNew.id);
    expect(ids).toHaveLength(0);
  });
});
```

2. **Run it to confirm it fails.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/pages/orphan-purge.test.ts
```

Expected: FAIL — cannot find module `@/lib/pages/orphan-purge` (the file does not exist yet).

3. **Minimal implementation.** Create `src/lib/pages/orphan-purge.ts`:

```ts
/**
 * v0.9.8 G4 (H) — Orphan-empty-Untitled page sweep.
 *
 * Selects pages that are simultaneously the default title ('Untitled'), have
 * empty extracted text (content_text = ''), are not already trashed
 * (deleted_at IS NULL), are childless (no row points at them via parent_id),
 * and are older than `olderThanDays`. `dryRun` lists candidates without
 * mutating; otherwise each candidate is soft-deleted by setting deleted_at.
 *
 * Reads existing columns only — no migration. Exposed as a pure function (a
 * Drizzle db in, a summary out) so tests can drive it directly without
 * spawning the CLI child process, mirroring `runAutoUnlockSweep`.
 *
 * The selection + soft-delete run inside a single transaction with the
 * candidate rows locked FOR UPDATE so a concurrent edit (which would clear the
 * Untitled/empty condition) can't race the delete.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

export type OrphanPurgeCandidate = {
  pageId: string;
  workspaceId: string;
};

export type OrphanPurgeResult = {
  candidates: OrphanPurgeCandidate[];
  purgedCount: number;
};

export type OrphanPurgeOptions = {
  olderThanDays: number;
  dryRun: boolean;
};

export async function runOrphanPurge(
  db: PostgresJsDatabase<typeof schema>,
  opts: OrphanPurgeOptions,
): Promise<OrphanPurgeResult> {
  const olderThan = String(opts.olderThanDays);
  return db.transaction(async (tx) => {
    const candidates = (await tx.execute(sql`
      SELECT id AS page_id, workspace_id
        FROM pages
       WHERE title = 'Untitled'
         AND content_text = ''
         AND deleted_at IS NULL
         AND id NOT IN (SELECT parent_id FROM pages WHERE parent_id IS NOT NULL)
         AND created_at < now() - (${olderThan}::text || ' days')::interval
       FOR UPDATE
    `)) as unknown as Array<{ page_id: string; workspace_id: string }>;

    const mapped = candidates.map((r) => ({ pageId: r.page_id, workspaceId: r.workspace_id }));

    if (opts.dryRun || mapped.length === 0) {
      return { candidates: mapped, purgedCount: 0 };
    }

    await tx.execute(sql`
      UPDATE pages
         SET deleted_at = now()
       WHERE title = 'Untitled'
         AND content_text = ''
         AND deleted_at IS NULL
         AND id NOT IN (SELECT parent_id FROM pages WHERE parent_id IS NOT NULL)
         AND created_at < now() - (${olderThan}::text || ' days')::interval
    `);

    return { candidates: mapped, purgedCount: mapped.length };
  });
}
```

4. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/pages/orphan-purge.test.ts
```

Expected: PASS (3 passed).

5. **Commit.**

```sh
git add src/lib/pages/orphan-purge.ts tests/lib/pages/orphan-purge.test.ts && git commit -m "feat(pages): orphan-empty-Untitled purge selection + soft-delete (G4 H)"
```

---

## Task 5 — `pages:purge-orphans` arg parsing (`--older-than`, `--dry-run`)

Extend the CLI arg parser so `pages:purge-orphans` is a known command with an `--older-than <days>` flag (default applied in `main()`, not here) and a `--dry-run` boolean flag. Mirrors how `pages:auto-unlock` was added to `KNOWN_COMMANDS` and how `--retention-days` is validated.

### Files
- **Modify** `src/server/cli-internal.ts` — add `'pages:purge-orphans'` to the `CliArgs['command']` union (lines 26-40) and to `KNOWN_COMMANDS` (lines 61-93); add `olderThanDays?: number` and `dryRun: boolean` to `CliArgs` (after line 58); parse `--older-than` (positive integer, like `--retention-days`) and `--dry-run` (boolean) in the loop (lines 118-157); thread both into the returned object (lines 177-191).
- **Modify** `tests/server/cli-internal.test.ts` (if present) OR **Create** `tests/server/cli-purge-orphans-args.test.ts` — unit test for the new parsing. This task creates a dedicated test file to avoid coupling to any existing file's shape.

### Steps

1. **Write the failing test.** Create `tests/server/cli-purge-orphans-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseArgs } from '@/server/cli-internal';

describe('parseArgs pages:purge-orphans', () => {
  it('parses the bare command with no flags (default older-than applied by main)', () => {
    const args = parseArgs(['pages:purge-orphans']);
    expect(args.command).toBe('pages:purge-orphans');
    expect(args.olderThanDays).toBeUndefined();
    expect(args.dryRun).toBe(false);
  });

  it('parses --older-than and --dry-run', () => {
    const args = parseArgs(['pages:purge-orphans', '--older-than', '7', '--dry-run']);
    expect(args.olderThanDays).toBe(7);
    expect(args.dryRun).toBe(true);
  });

  it('rejects a non-positive --older-than', () => {
    expect(() => parseArgs(['pages:purge-orphans', '--older-than', '0'])).toThrow(
      /--older-than requires a positive integer/,
    );
  });
});
```

2. **Run it to confirm it fails.**

```sh
source ~/.zshenv && pnpm vitest run tests/server/cli-purge-orphans-args.test.ts
```

Expected: FAIL — `parseArgs(['pages:purge-orphans'])` throws `Unknown command: pages:purge-orphans` (it is not yet in `KNOWN_COMMANDS`).

3. **Minimal implementation.** Edit `src/server/cli-internal.ts`.

Add to the `CliArgs['command']` union (after `'pages:auto-unlock'`, line 36):

```ts
    | 'pages:auto-unlock'
    | 'pages:purge-orphans'
```

Add the two new fields to the `CliArgs` interface (after `connectorId?: string;`, line 58):

```ts
  connectorId?: string;
  /** v0.9.8 G4 (H) — pages:purge-orphans age threshold in days. Undefined here;
   *  the default (30) is applied by the dispatcher in cli.ts. */
  olderThanDays?: number;
  /** v0.9.8 G4 (H) — when true, pages:purge-orphans lists candidates without
   *  soft-deleting them. */
  dryRun: boolean;
```

Add to `KNOWN_COMMANDS` (after the `'pages:auto-unlock'` entry, around line 74):

```ts
  'pages:auto-unlock',
  // v0.9.8 G4 (H) — soft-deletes orphan-empty-Untitled pages older than
  // --older-than days (default 30). --dry-run lists candidates only. Reads
  // existing columns; no schema migration.
  'pages:purge-orphans',
```

Declare the locals (next to `let connectorId`, line 115):

```ts
  let connectorId: string | undefined;
  let workspaceId: string | undefined;
  let olderThanDays: number | undefined;
  let dryRun = false;
```

Parse the flags in the loop. Add these branches just before the final `else throw new Error(\`Unknown flag: ${a}\`);` (line 157):

```ts
    else if (a === '--connector') connectorId = rest[++i];
    else if (a === '--older-than') {
      const raw = rest[++i];
      const n = Number(raw);
      if (raw === undefined || !Number.isInteger(n) || n < 1) {
        throw new Error('--older-than requires a positive integer');
      }
      olderThanDays = n;
    } else if (a === '--dry-run') dryRun = true;
    else throw new Error(`Unknown flag: ${a}`);
```

Thread both into the returned object (after `connectorId,`, line 190):

```ts
    connectorId,
    olderThanDays,
    dryRun,
  };
```

4. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm vitest run tests/server/cli-purge-orphans-args.test.ts
```

Expected: PASS (3 passed).

5. **Commit.**

```sh
git add src/server/cli-internal.ts tests/server/cli-purge-orphans-args.test.ts && git commit -m "feat(cli): parse pages:purge-orphans --older-than/--dry-run (G4 H)"
```

---

## Task 6 — `orphan-purge-cli.ts` shim + `cli.ts` dispatch + usage line

Wire the command end-to-end: a thin CLI shim that opens a `postgres()` connection and calls `runOrphanPurge`, plus the `main()` dispatch branch (default `--older-than` to 30, log the summary, `recordCliAudit`) and the `--help` usage line. Mirrors the `pages:auto-unlock` shim and dispatch exactly.

### Files
- **Create** `src/lib/pages/orphan-purge-cli.ts` — thin shim mirroring `src/lib/pages/auto-unlock-cli.ts`.
- **Modify** `src/server/cli.ts` — add the dispatch branch after the `pages:auto-unlock` branch (line 428), and add the usage line in the `parseArgs` catch block (after `cli pages:auto-unlock`, line 327).
- **Create** `tests/server/orphan-purge-cli.test.ts` — Testcontainers test driving `runOrphanPurgeCli` against a real DB via `process.env.DATABASE_URL`.

### Steps

1. **Write the failing test.** Create `tests/server/orphan-purge-cli.test.ts`:

```ts
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { runOrphanPurgeCli } from '@/lib/pages/orphan-purge-cli';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let uri: string;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const prevUrl = process.env.DATABASE_URL;

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  process.env.DATABASE_URL = prevUrl;
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

describe('runOrphanPurgeCli', () => {
  it('soft-deletes an aged orphan via its own connection', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db.execute(drizzleSql`
      UPDATE pages SET created_at = now() - interval '60 days' WHERE id = ${orphan.id}
    `);

    const result = await runOrphanPurgeCli({ olderThanDays: 30, dryRun: false });
    expect(result.purgedCount).toBe(1);

    const [row] = (await db.execute(drizzleSql`
      SELECT deleted_at FROM pages WHERE id = ${orphan.id}
    `)) as unknown as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('dry-run lists without deleting', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db.execute(drizzleSql`
      UPDATE pages SET created_at = now() - interval '60 days' WHERE id = ${orphan.id}
    `);

    const result = await runOrphanPurgeCli({ olderThanDays: 30, dryRun: true });
    expect(result.purgedCount).toBe(0);
    expect(result.candidates.map((c) => c.pageId)).toContain(orphan.id);
  });
});
```

2. **Run it to confirm it fails.**

```sh
source ~/.zshenv && pnpm vitest run tests/server/orphan-purge-cli.test.ts
```

Expected: FAIL — cannot find module `@/lib/pages/orphan-purge-cli`.

3. **Minimal implementation — shim.** Create `src/lib/pages/orphan-purge-cli.ts`:

```ts
/**
 * v0.9.8 G4 (H) — `cli pages:purge-orphans` entry point.
 *
 * Thin shim — opens a postgres-js connection from DATABASE_URL, runs one
 * `runOrphanPurge`, returns the summary. The scheduler/operator reads the count
 * via the CLI's stdout line ("[pages:purge-orphans] dryRun=… purged=N").
 * Mirrors `runAutoUnlockCli`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { type OrphanPurgeResult, runOrphanPurge } from './orphan-purge';

export async function runOrphanPurgeCli(opts: {
  olderThanDays: number;
  dryRun: boolean;
}): Promise<OrphanPurgeResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for pages:purge-orphans');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    return await runOrphanPurge(db, opts);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```

4. **Minimal implementation — dispatch + usage.** Edit `src/server/cli.ts`.

Add the usage line in the `parseArgs` catch block, after `\`  cli pages:auto-unlock\\n\`` (line 327):

```ts
        `  cli pages:auto-unlock\n` +
        `  cli pages:purge-orphans [--older-than N] [--dry-run]\n` +
```

Add the dispatch branch immediately after the `pages:auto-unlock` branch closes (after line 428, before the `flashcards:notify-due` branch):

```ts
  } else if (args.command === 'pages:purge-orphans') {
    // v0.9.8 G4 (H) — global sweep that soft-deletes orphan-empty-Untitled
    // pages older than --older-than days (default 30). --dry-run lists only.
    const olderThanDays = args.olderThanDays ?? 30;
    const { runOrphanPurgeCli } = await import('../lib/pages/orphan-purge-cli.js');
    const summary = await runOrphanPurgeCli({ olderThanDays, dryRun: args.dryRun });
    if (args.dryRun) {
      console.log(
        `[pages:purge-orphans] dry-run olderThanDays=${olderThanDays} candidates=${summary.candidates.length}`,
      );
      for (const c of summary.candidates) {
        console.log(`  ${c.pageId} (workspace ${c.workspaceId})`);
      }
    } else {
      console.log(
        `[pages:purge-orphans] olderThanDays=${olderThanDays} purged=${summary.purgedCount}`,
      );
    }
    await recordCliAudit(conn, 'pages.orphans_purged', {
      olderThanDays,
      dryRun: args.dryRun,
      count: args.dryRun ? summary.candidates.length : summary.purgedCount,
    });
```

5. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm vitest run tests/server/orphan-purge-cli.test.ts
```

Expected: PASS (2 passed).

6. **Commit.**

```sh
git add src/lib/pages/orphan-purge-cli.ts src/server/cli.ts tests/server/orphan-purge-cli.test.ts && git commit -m "feat(cli): wire pages:purge-orphans dispatch + audit (G4 H)"
```

---

## Task 7 — Playwright e2e: created page appears in sidebar tree < 1s, no reload

Prove item (G)'s acceptance criterion end-to-end: clicking "New page" in the sidebar makes the new page's title appear in the sidebar tree within 1s, with no manual reload. `NewPageButton` already does `router.push` + `router.refresh()`; this test guards against regression of the live-refetch contract. The new page is created with the default title `'Untitled'` (the `pages.title` default). The test uses the existing a11y harness fixtures + `signIn`, navigates to the app root, records the current count of `Untitled` rows in the tree, clicks the labelled "New page" button, and asserts an additional `Untitled` row appears within 1000ms without calling `page.reload()`.

### Files
- **Create** `tests/a11y/live-refetch.spec.ts` — Playwright spec under the harness `testDir` (`tests/a11y`, `testMatch: '**/*.spec.ts'`), using `tests/a11y/fixtures.ts` (`test`, `expect`, `signIn`).

### Steps

1. **Write the failing test.** Create `tests/a11y/live-refetch.spec.ts`:

```ts
import { expect, signIn, test } from './fixtures';

// v0.9.8 G4 (G) — clicking "New page" must surface the new page in the
// server-rendered sidebar tree within 1s WITHOUT a manual reload. The button
// (src/components/new-page-button.tsx) does router.push + router.refresh; this
// guards the refresh contract. We never call page.reload().
test.describe('live sidebar refetch', () => {
  test('a newly created page appears in the sidebar tree under 1s with no reload', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const newPageButton = page.getByRole('button', { name: 'New page', exact: true });
    await expect(newPageButton).toBeVisible();

    // Baseline count of "Untitled" rows in the sidebar before creating one.
    const untitledRows = page.getByText('Untitled', { exact: true });
    const before = await untitledRows.count();

    const start = Date.now();
    await newPageButton.click();

    // The new page navigates to /pages/<id> and the sidebar re-renders via
    // router.refresh(). Assert one more "Untitled" row appears within 1s.
    await expect
      .poll(() => untitledRows.count(), { timeout: 1000, intervals: [50, 100, 200] })
      .toBeGreaterThan(before);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
```

2. **Run it to confirm it fails (or is correctly green against the shipped refresh).** Because `NewPageButton` already refreshes, this e2e is a regression guard rather than a red→green driver. To honor the run-to-fail step, temporarily prove the test is load-bearing: comment out `router.refresh();` in `src/components/new-page-button.tsx` line 25, run the spec, observe the poll time out (FAIL), then restore the line. Build + run:

```sh
source ~/.zshenv && pnpm build && pnpm playwright test tests/a11y/live-refetch.spec.ts --project=light
```

Expected with `router.refresh()` removed: FAIL — `expect.poll` times out (the new row never appears without a reload). After restoring the line: PASS.

3. **Restore + minimal implementation.** Ensure `src/components/new-page-button.tsx` line 25 reads exactly:

```tsx
      router.push(`/pages/${created.id}` as Route);
      router.refresh();
```

(No production change is required if it was never edited; this step only confirms the refresh contract the test depends on.)

4. **Run it to confirm it passes.**

```sh
source ~/.zshenv && pnpm playwright test tests/a11y/live-refetch.spec.ts --project=light
```

Expected: PASS (1 passed).

5. **Commit.**

```sh
git add tests/a11y/live-refetch.spec.ts && git commit -m "test(e2e): assert created page hits sidebar tree under 1s no reload (G4 G)"
```

---

## Task 8 — G4 verification gate

Run the full per-group gate from spec Section 4. All must pass before this group is considered complete. No code changes in this task unless a gate fails (fix-forward in the relevant task above, then re-run the gate).

### Steps

1. **Lint (0 errors).**

```sh
source ~/.zshenv && pnpm lint
```

Expected: exits 0, no errors. (Biome may report formatting it can auto-fix; if so, run `pnpm exec biome check --write .`, re-stage, and amend the relevant task's commit — reordered imports / `import type` conversions / line reflow are expected per CLAUDE.md.)

2. **Typecheck.**

```sh
source ~/.zshenv && pnpm typecheck
```

Expected: exits 0, no `tsc --noEmit` errors.

3. **i18n check (no new untranslated keys).**

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exits 0. G4 introduces **no new user-facing strings** (all changes are `router.refresh()` calls, CLI stdout, and tests), so there should be zero new keys and `i18n:check` must not flag anything new. If it reports new keys, a stray UI string was added — remove it.

4. **Group Vitest (the four G4 test files).**

```sh
source ~/.zshenv && pnpm vitest run tests/components/comment-panel-refresh.test.tsx tests/components/sidebar-favorites-refresh.test.tsx tests/components/notifications-mark-read-refresh.test.tsx tests/lib/pages/orphan-purge.test.ts tests/server/cli-purge-orphans-args.test.ts tests/server/orphan-purge-cli.test.ts
```

Expected: all passed (6 files; component tests + Testcontainers tests green). If a Testcontainers file fails with `ECONNREFUSED`, ensure Docker/Colima is up (`source ~/.zshenv && colima start`) and re-run — do NOT disable Vitest isolation.

5. **Build (BUILD_EXIT=0).**

```sh
source ~/.zshenv && pnpm build; echo "BUILD_EXIT=$?"
```

Expected: `BUILD_EXIT=0`. (The in-build TS phase is skipped per the v0.9.7 fix; types are gated by the typecheck step above.)

6. **Playwright e2e (G4 spec).**

```sh
source ~/.zshenv && pnpm playwright test tests/a11y/live-refetch.spec.ts --project=light
```

Expected: PASS (1 passed). If it flakes on a self-hosted runner (137/255/SIGKILL), re-run — flake, not failure, per spec Section 5.

7. **Commit (gate marker, only if any fix-forward edits were needed; otherwise skip).**

```sh
git add -A && git commit -m "chore(g4): pass live-refetch + orphan-sweep verification gate"
```
