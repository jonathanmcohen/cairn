# v0.9.9 Plan G — Search & Refresh Consistency

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the "refetch gap" cluster (scope G11) for the three live-audit findings where a successful mutation toasts/persists but the surrounding UI never re-reads: G1 the version-history drawer (#75/#256), G2 the saved-search sidebar list (#88/#266), and G3 the semantic-search result snippet/score parity with keyword mode (#41/#220). The first two get a single standardized client-side mutation-notify primitive (`src/lib/client/mutation-bus.ts`) layered on top of the app's existing `router.refresh()` convention, so a mutation in one component (e.g. "save search" in the ⌘K palette) deterministically refreshes a sibling component (the sidebar list) without a full reload. G3 brings the semantic/hybrid retrieval path to snippet+score parity with FTS so the `/search` surface renders consistent rows regardless of mode.

**Architecture:** Cairn uses `router.refresh()` (App Router server-component re-render) for server-data freshness, NOT TanStack Query. The audit found this works where a mutation and its reader live in the same client component (version-history's manual snapshot already calls a local `refetch()`; db filter second-click re-runs) but breaks across component boundaries: the saved-search sidebar (`SavedSearches`, mounted in `sidebar-content.tsx`) only `fetch`es on mount, while the create path lives in a *different* component (`search-palette.tsx`) and the rename/delete path lives in `SavedSearches` itself — so a palette "save" never reaches the sidebar. We introduce a tiny dependency-free `EventTarget`-backed bus (`mutation-bus.ts`) plus a `useMutationRefresh(topic, cb)` hook: emitters call `emitMutation('savedSearches')`; subscribers re-fetch. The same primitive lets the version-history drawer re-fetch when *any* snapshot mutation fires (manual save OR a future autosave-emit), and re-fetch on window `focus`/`visibilitychange` so a drawer left open reflects server-side autosaved versions. G3 is pure server-lib work in `src/lib/pages/search.ts`: add `ts_headline`-equivalent body snippets to the semantic kNN rows by joining `pages.content_text` and generating a leading excerpt, and normalize the `rank` field so semantic/hybrid scores land in the same `[0,1]` band the FTS path already returns.

**Tech Stack:** Next.js 16 App Router (`router.refresh()`), React 19 (`useEffect`/`useCallback`/`useSyncExternalStore`-free custom hook over `EventTarget`), TypeScript 6 strict, Drizzle + Postgres (raw `db.execute(rawSql\`…\`)` for the FTS/kNN CTEs), pgvector cosine distance, Vitest 4 + Testcontainers (real Postgres for the search-lib tests), Biome v2, i18n en/es/ar via `useT()` (flat dotted keys in `messages/{en,es,ar}.json`). No new migration is required for G1/G2; **G3 ships migration 0062** (the next free number per scope) to add a GIN index that makes the new semantic-snippet `content_text` excerpt query cheap, hand-appended after `db:generate`.

---

## G1 — Version-history drawer refetches on every snapshot mutation + on focus (#75/#256)

**Cause (scope):** `version-history.tsx` toasts on save but the drawer can go stale — its `useEffect` only fires on the `open` *transition* (`[open, refetch]`), so versions autosaved server-side while the drawer stays open never appear, and there is no cross-component signal when a snapshot is created elsewhere. The manual `saveSnapshotNow()` already calls `refetch()` (line 147); we keep that, add a window `focus`/`visibilitychange` refetch while open, and route the manual save through the new mutation bus so the pattern is uniform with G2.

**Files:**
- Create: `src/lib/client/mutation-bus.ts`
- Create: `src/lib/client/mutation-bus.test.ts`
- Create: `src/components/pages/version-history.test.tsx`
- Modify: `src/components/pages/version-history.tsx`

- [ ] Write failing test `src/lib/client/mutation-bus.test.ts`: a vitest unit test (jsdom — no DB) asserting the bus contract. Real code, no placeholders:
  ```ts
  import { afterEach, expect, it, vi } from 'vitest';
  import { emitMutation, subscribeMutation } from './mutation-bus';

  afterEach(() => vi.restoreAllMocks());

  it('delivers emit to a subscriber for the same topic', () => {
    const cb = vi.fn();
    const off = subscribeMutation('savedSearches', cb);
    emitMutation('savedSearches');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    emitMutation('savedSearches');
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it('does not cross topics', () => {
    const cb = vi.fn();
    const off = subscribeMutation('pageVersions', cb);
    emitMutation('savedSearches');
    expect(cb).not.toHaveBeenCalled();
    off();
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run src/lib/client/mutation-bus.test.ts` (module does not exist → fail).
- [ ] Minimal impl `src/lib/client/mutation-bus.ts`:
  ```ts
  'use client';

  /**
   * Tiny dependency-free pub/sub for client-side mutation notifications.
   *
   * Cairn relies on App Router `router.refresh()` for server-data freshness,
   * but that only re-renders server components — sibling *client* components
   * (e.g. the saved-search sidebar vs. the ⌘K palette that creates one) hold
   * their own fetched state and never hear about each other's mutations. This
   * bus is the standardized signal: a mutating component calls
   * `emitMutation(topic)`, every component reading that topic re-fetches.
   *
   * Backed by a single module-level EventTarget so there is exactly one bus
   * per browser tab. SSR-safe: EventTarget exists in the Node/edge runtime, and
   * all callers are 'use client'.
   */
  export type MutationTopic = 'savedSearches' | 'pageVersions';

  const bus = new EventTarget();

  export function emitMutation(topic: MutationTopic): void {
    bus.dispatchEvent(new Event(topic));
  }

  export function subscribeMutation(topic: MutationTopic, cb: () => void): () => void {
    bus.addEventListener(topic, cb);
    return () => bus.removeEventListener(topic, cb);
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run src/lib/client/mutation-bus.test.ts`.
- [ ] Commit: `feat(client): add mutation-bus pub/sub for cross-component refetch`
- [ ] Write failing test `src/components/pages/version-history.test.tsx`: render with `@testing-library/react`, mock `fetch`, open the drawer, assert it fetches once; then `emitMutation('pageVersions')` and assert a second fetch; then fire `window` `focus` and assert a third. Real code:
  ```tsx
  import { fireEvent, render, screen, waitFor } from '@testing-library/react';
  import { afterEach, beforeEach, expect, it, vi } from 'vitest';
  import { I18nProvider } from '@/lib/i18n/provider';
  import { emitMutation } from '@/lib/client/mutation-bus';
  import { VersionHistory } from './version-history';

  function renderVH() {
    return render(
      <I18nProvider locale="en">
        <VersionHistory pageId="11111111-1111-1111-1111-111111111111" canEdit />
      </I18nProvider>,
    );
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refetches versions on open, on mutation-bus emit, and on window focus', async () => {
    renderVH();
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    emitMutation('pageVersions');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run src/components/pages/version-history.test.tsx` (only the open-fetch fires → 2nd/3rd assertions fail).
- [ ] Minimal impl in `src/components/pages/version-history.tsx`: import the bus and subscribe while open. Add after the existing `useEffect(() => { if (open) void refetch(); }, [open, refetch]);`:
  ```tsx
  import { emitMutation, subscribeMutation } from '@/lib/client/mutation-bus';

  // Re-fetch while the drawer is open whenever a snapshot mutation fires
  // anywhere (manual save below, or a future autosave emit) and whenever the
  // tab regains focus — so a left-open drawer reflects server-side autosaves.
  useEffect(() => {
    if (!open) return;
    const onFocus = () => void refetch();
    const offBus = subscribeMutation('pageVersions', onFocus);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      offBus();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [open, refetch]);
  ```
  And in `saveSnapshotNow()` and `restore()`, after the existing `await refetch();`, add `emitMutation('pageVersions');` so any *other* open instance (e.g. drawer + future inline timeline) stays in sync:
  ```tsx
    toast.success(t('pageActions.versions.saved'));
    await refetch();
    emitMutation('pageVersions');
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run src/components/pages/version-history.test.tsx`.
- [ ] Commit: `fix(pages): refetch version-history drawer on snapshot mutation + focus (#256)`

---

## G2 — Saved-search sidebar live-updates via the mutation bus (#88/#266)

**Cause (scope):** "no refresh on save." `SavedSearches` (`src/components/sidebar/saved-searches.tsx`) fetches `/api/search/saved` once on mount and only mutates local state for its own rename/delete. The *create* path lives in a different component (`search-palette.tsx#saveCurrent`, POST `/api/search/saved`), which refreshes only its own `saved` state via `refreshSaved()`. With no shared signal, saving from the palette never appears in the sidebar until a full reload. Fix: emit `'savedSearches'` from every saved-search mutation (palette create, sidebar rename, sidebar delete) and have `SavedSearches` re-fetch on that topic. Because the sidebar returns `null` when empty, the bus subscription must live above the early `return null` so a first-ever save makes the section appear.

**Files:**
- Create: `src/components/sidebar/saved-searches.test.tsx`
- Modify: `src/components/sidebar/saved-searches.tsx`
- Modify: `src/components/search-palette.tsx`

- [ ] Write failing test `src/components/sidebar/saved-searches.test.tsx`: mount with an empty list (renders nothing), then mock `fetch` to return one row and `emitMutation('savedSearches')`, assert the row appears. Real code:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import { afterEach, expect, it, vi } from 'vitest';
  import { I18nProvider } from '@/lib/i18n/provider';
  import { ConfirmProvider } from '@/components/ui/confirm-dialog';
  import { emitMutation } from '@/lib/client/mutation-bus';
  import { SavedSearches } from './saved-searches';

  afterEach(() => vi.unstubAllGlobals());

  it('appears after a savedSearches mutation is emitted from elsewhere', async () => {
    let payload: unknown = { savedSearches: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    render(
      <I18nProvider locale="en">
        <ConfirmProvider>
          <SavedSearches />
        </ConfirmProvider>
      </I18nProvider>,
    );
    // Empty → renders nothing.
    await waitFor(() => expect(screen.queryByText('Open issues')).toBeNull());

    payload = { savedSearches: [{ id: 'a', name: 'Open issues', query: 'is:open', filters: {} }] };
    emitMutation('savedSearches');
    await waitFor(() => expect(screen.getByText('Open issues')).toBeInTheDocument());
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run src/components/sidebar/saved-searches.test.tsx` (no bus subscription → row never appears).
- [ ] Minimal impl in `src/components/sidebar/saved-searches.tsx`: extract the loader into a `useCallback` and subscribe to the bus. Replace the mount-only effect:
  ```tsx
  import { useCallback, useEffect, useState } from 'react';
  import { emitMutation, subscribeMutation } from '@/lib/client/mutation-bus';

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/search/saved');
      if (!r.ok) return;
      const data = (await r.json()) as { savedSearches: Saved[] };
      setItems(data.savedSearches);
    } catch {
      // silent — section just stays empty
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeMutation('savedSearches', () => void load());
  }, [load]);
  ```
  And make the local rename/delete mutations *also* emit so the palette's list stays in sync. In `remove()` after `setItems(...filter)` add `emitMutation('savedSearches');`; in `saveRename()` after the `setItems(...map)` add `emitMutation('savedSearches');`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run src/components/sidebar/saved-searches.test.tsx`.
- [ ] Commit: `fix(sidebar): live-update saved-search list via mutation bus (#266)`
- [ ] Modify `src/components/search-palette.tsx#saveCurrent`: emit on successful create so the sidebar updates. Import `emitMutation` and change the `if (r.ok)` block:
  ```tsx
  import { emitMutation } from '@/lib/client/mutation-bus';

    if (r.ok) {
      void refreshSaved();
      emitMutation('savedSearches');
      toast(t('palette.saveSearch.saved'));
    }
  ```
  (No new test file for the palette beyond the existing palette suite; this is one line wired to the already-tested bus. Verify the existing palette tests still pass.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run src/components/search-palette.test.tsx` (if present) and `src/components/sidebar/saved-searches.test.tsx`.
- [ ] Commit: `fix(palette): emit savedSearches mutation so sidebar refreshes on save (#266)`

---

## G3 — Semantic/hybrid search snippet + score parity with keyword mode (#41/#220)

**Cause (scope):** `searchSemantic()` in `src/lib/pages/search.ts` (lines 148–187) returns `snippet: null` for every hit and a `rank` of `1 - cosineDistance`, while `searchFts()` returns a `ts_headline` body excerpt and a `ts_rank` score. On `/search` the result row in `search-page-view.tsx` only renders `r.snippet` when truthy, so semantic/hybrid rows show a bare title with no context and a score on a different scale than keyword rows — inconsistent UX (#41) and the audit's score-parity gap (#220). Fix: in the semantic kNN query, join `pages.content_text` and emit a leading excerpt as `snippet`, and normalize the returned `rank` into the same `[0,1]` band the FTS path uses, so hybrid RRF and the UI treat all modes uniformly. A small `excerpt()` helper (pure) trims to a word boundary so we get a readable lead-in without a tsquery (semantic has no query terms to headline around).

**Files:**
- Modify: `src/lib/pages/search.ts`
- Modify: `src/lib/pages/search.test.ts` (extend existing semantic test)
- Create: `drizzle/migrations/0062_semantic_snippet_index.sql`

- [ ] Write failing test in `src/lib/pages/search.test.ts` (Testcontainers Postgres, real pgvector): seed a page with `content_text` and a known embedding, run `searchPages(db, { mode: 'semantic', ... })`, assert the hit now carries a non-null `snippet` containing the body's leading words and a `rank` in `(0, 1]`. Real code (append to the semantic describe block):
  ```ts
  it('returns a body snippet and a [0,1] rank for semantic hits (parity with fts)', async () => {
    const pageId = await seedPageWithEmbedding(db, {
      workspaceId,
      title: 'Quarterly planning',
      contentText:
        'The quarterly planning session covers OKRs, headcount, and the roadmap for the next twelve weeks.',
    });
    const results = await searchPages(db, {
      workspaceId,
      query: 'planning goals',
      mode: 'semantic',
      limit: 5,
    });
    const hit = results.find((r) => r.id === pageId);
    expect(hit).toBeDefined();
    expect(hit?.snippet).toBeTruthy();
    expect(hit?.snippet).toContain('quarterly planning');
    expect(hit?.rank).toBeGreaterThan(0);
    expect(hit?.rank).toBeLessThanOrEqual(1);
  });
  ```
  (Reuse the file's existing `seedPageWithEmbedding`/`searchPages` import + workspace setup; if the helper does not yet expose `contentText`, extend it to `UPDATE pages SET content_text = $contentText` after insert — `content_tsv` is trigger-maintained.)
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run src/lib/pages/search.test.ts` (`snippet` is `null` → assertion fails).
- [ ] Minimal impl — add a pure excerpt helper near the top of `src/lib/pages/search.ts`:
  ```ts
  /**
   * Leading-excerpt for snippet parity in modes that have no tsquery to
   * headline around (semantic kNN). Trims to a word boundary near `max` chars
   * and appends an ellipsis when truncated. Pure — unit-testable, no DB.
   */
  function excerpt(text: string | null, max = 160): string | null {
    if (!text) return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean || null;
    const cut = clean.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  ```
  Then change `searchSemantic()` to select `content_text` and map snippet+rank. Replace the query + map:
  ```ts
    const rows = (await db.execute(rawSql`
      SELECT p.id AS id, p.title AS title, p.content_text AS content_text,
             (e.embedding <=> ${vecLiteral}::vector) AS distance
      FROM page_embeddings e
      JOIN pages p ON p.id = e.page_id
      WHERE e.workspace_id = ${input.workspaceId}
        AND p.deleted_at IS NULL
        AND p.encrypted = false
        AND p.status NOT IN ('draft','archived')
      ORDER BY e.embedding <=> ${vecLiteral}::vector ASC
      LIMIT ${limit}
    `)) as unknown as {
      id: string;
      title: string;
      content_text: string | null;
      distance: number;
    }[];

    // Cosine distance ∈ [0,2]; map to a [0,1] relevance band (1 - d/2) so
    // semantic/hybrid scores share the FTS path's "higher is better, ~[0,1]"
    // contract and RRF/UI can treat every mode uniformly.
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: excerpt(r.content_text),
      rank: Math.max(0, Math.min(1, 1 - Number(r.distance) / 2)),
      breadcrumb: [],
    }));
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run src/lib/pages/search.test.ts`.
- [ ] Commit: `fix(search): semantic snippet + normalized score parity with keyword mode (#41, #220)`
- [ ] Create migration `drizzle/migrations/0062_semantic_snippet_index.sql` — the new query reads `pages.content_text` for the kNN result set; add a covering-friendly index so the join stays cheap on large workspaces. Hand-written (db:generate does not emit functional/partial indexes), full SQL:
  ```sql
  -- 0062 v0.9.9 G3 (#41/#220): support the semantic-snippet join.
  -- searchSemantic() now also reads pages.content_text for the kNN hit set.
  -- This partial index keeps the page lookup on the search-visible rows cheap
  -- (the same predicate searchFts/searchSemantic apply) without indexing
  -- soft-deleted, encrypted, or non-published pages.
  CREATE INDEX IF NOT EXISTS pages_search_visible_idx
    ON pages (workspace_id, id)
    WHERE deleted_at IS NULL
      AND encrypted = false
      AND status NOT IN ('draft', 'archived');
  ```
- [ ] Run to pass (entrypoint applies the migration; the Testcontainers harness runs all migrations on `beforeAll`): `source ~/.zshenv && pnpm vitest run src/lib/pages/search.test.ts`.
- [ ] Commit: `feat(db): migration 0062 partial index for search-visible pages (#41)`

---

## G4 — i18n: no new user-facing strings introduced

This plan adds no new visible copy. The version-history drawer reuses existing `pageActions.versions.*` keys (`saved`, `saveFailed`, `autosaveHint`, `saveNow`, `saving`, `title`, `close`, `empty.*`); the saved-search sidebar reuses existing `savedSearches.*` keys (`heading`, `rename`, `renameLabel`, `deleteLabel`, `confirmDelete`, `save`, `cancel`); the `/search` snippet is server-derived page content, not a translated string, and renders inside the existing `search.page.*`/`search.mode.*` scaffolding. The semantic excerpt's trailing ellipsis (`…`) is a typographic character, not a localizable phrase.

- [ ] Confirm zero new keys: `source ~/.zshenv && pnpm lint` includes the i18n Biome rule, and the per-group gate's `i18n none-new` check (below) must report no additions across `messages/{en,es,ar}.json`. If any future edit in this plan introduces a string, STOP and add all three locales before proceeding (en/es/ar parity is enforced).

---

## G5 — Per-group gate (HOLD for GO)

Single PR onto `patches/v0.9.9`. Run the full gate on a GitHub-hosted runner (no self-hosted), Biome must report 0 errors, zero-deferral, full vitest, plus the new e2e UI-acceptance gate for this search/nav-adjacent group.

- [ ] Lint: `source ~/.zshenv && pnpm lint` → **0 errors** (Biome v2; accept its import-order/`import type`/line-reflow auto-fixes via `biome check --write` then re-run).
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck` → clean (`tsc --noEmit`, TS6 strict).
- [ ] i18n none-new: verify `messages/{en,es,ar}.json` have no added keys vs. `patches/v0.9.9` base and remain key-parity equal across all three locales (this group adds none — see G4).
- [ ] **Full** test suite: `source ~/.zshenv && pnpm vitest run` (entire suite, Testcontainers Postgres + pgvector; isolation stays `isolate: true` per CLAUDE.md). All green.
- [ ] Build: `source ~/.zshenv && pnpm build` (next build + entrypoint tsc).
- [ ] e2e UI-acceptance gate (route-reachability + per-feature deployed-image check) on the built/deployed image:
  - Route-reachability smoke: `/search` returns 200 and renders the mode toggle (Keyword/Semantic/Hybrid) and a result list region; the sidebar mounts `SavedSearches`.
  - Per-feature deployed-image checks: (a) **#256** open a page's Version history drawer, click "Save snapshot now", confirm a new version row appears without a page reload, then switch tab away and back and confirm the list reflects any autosaved version on focus; (b) **#266** open the ⌘K palette, save the current query as a saved search, confirm the new entry appears in the sidebar `Saved searches` section without reload, then rename it in the sidebar and confirm the palette's list reflects the new name; (c) **#41/#220** run a `/search` query in Semantic mode and confirm result rows show a body snippet (not title-only) and that switching to Keyword mode keeps row layout/score banding consistent.
- [ ] Open ONE PR for Plan G onto `patches/v0.9.9` and **HOLD for user GO** before merge. Do not push from a subagent; the controller/human pushes and merges.
