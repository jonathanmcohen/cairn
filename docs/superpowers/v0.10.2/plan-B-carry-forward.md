# Plan B — carry-forward (v0.10.2)

> **HOLD until GO.**

Two seeded items, both re-audited PARTIAL — **two fixes, nothing closed**. Both
carry premise corrections from the audit; the deltas are smaller than the
seeded reports claim. Plan B lands FIRST in the release order.

## Closed by re-audit — no work (0)

| Seed | Item | Verdict |
|------|------|---------|
| — | *None.* Both items remain open (PARTIAL); see task sections below. | — |

## B1 — Project tracker (database-kind) template clone strands the button

**Audit verdict: PARTIAL.** Server-side database-kind instantiation WORKS:
`instantiateTemplate` mints a host page via `randomUUID()`
(`src/lib/templates/instantiate.ts:60-77`, mint at line 64) and inserts
page + database + properties + views in one transaction; the route returns
201 quickly. The defect is the **return contract + client state**: the minted
host-page id is never surfaced — the return block
(`src/lib/templates/instantiate.ts:128-131`) returns
`rootPageId: rootId ?? undefined` where `rootId` is null for database
payloads, so the route sends `rootPageId: null`
(`src/app/api/templates/[id]/instantiate/route.ts:37-45`). The gallery's
`onUse` null-rootPageId success path calls `router.refresh()` with no
navigation, and `setBusy(null)` only runs in the catch — no `finally`
(`src/components/templates/templates-gallery.tsx:49-72`) — so `busy` stays
set and the button shows "Working…" (disabled,
`templates-gallery.tsx:179-183`) indefinitely. Project tracker is the ONLY
kind `'database'` built-in (`src/lib/templates/builtins.ts:126-184`), which
is why the other 3 templates (`builtins.ts:19-125`, all kind `'page'`) work.
The unit test for database-kind only asserts `rootDatabaseId`
(`tests/lib/templates/instantiate.test.ts:227`), so the missing host-page id
is untested.

**Premise corrections (audit, claimed ≠ actual):**

1. **Not an 8-second hang.** The POST returns fast and the button sticks
   **FOREVER** (until remount). The clone actually **succeeds** — the new
   host page silently appears in the sidebar after refresh.
2. **There is no timeout anywhere.** `onUse` uses bare `fetch` with no
   AbortController/timeout and no retry — nothing to "time out" at 8s.
3. **Errors are not toasts.** They render as an inline
   `<p className="text-sm text-destructive">` above the grid
   (`templates-gallery.tsx:110`); on this path **no error fires at all**, so
   nothing is shown. Sonner toast infra exists and is mounted
   (`src/components/ui/sonner.tsx`; Toaster at
   `src/app/(app)/layout.tsx:112`) but the gallery does not use it.
4. The gallery comment at lines 61-62 even claims "database-kind templates
   land on their host page" — the code does not deliver that. The onboarding
   wizard has the same null-rootPageId refresh fallback
   (`src/components/onboarding/wizard.tsx:110-117`) but dismisses itself
   first, so it does not visibly stick.

The seeded fix list (timeout + error toast + retry button) targets a hang
that doesn't exist. Once the return contract is fixed there is nothing to
retry; error-path hardening (fetch timeout + sonner error toast) is
explicitly **covered under P14**, not duplicated here.

**Gap to build (the delta only — server clone logic already works, do NOT
rebuild it):**

1. **Return contract:** in `instantiateTemplate`, capture the minted
   host-page id for database-kind payloads and return it as `rootPageId`
   (`instantiate.ts` lines 60-77 + 128-131, e.g.
   `rootPageId: rootId ?? mintedHostPageId`), so the route's existing
   `result.rootPageId ?? null` passes it through and the gallery's
   `router.push` branch fires.
2. **Client defense:** move `setBusy(null)` into a `finally` (or reset before
   `router.refresh()`) in `onUse` so a null `rootPageId` can never strand the
   button on "Working…" again.
3. **Test the contract:** extend the database-kind case in
   `tests/lib/templates/instantiate.test.ts` to assert `result.rootPageId`
   equals the inserted host page.

No new UI strings → no i18n delta for B1.

**Files:**

- `src/lib/templates/instantiate.ts` (primary — return contract)
- `src/components/templates/templates-gallery.tsx` (`finally` for `setBusy`)
- `src/app/api/templates/[id]/instantiate/route.ts` (pass-through; expected
  no-op, verify only)
- `tests/lib/templates/instantiate.test.ts` (extend database-kind case)

**Spec:** `tests/e2e/item-b1-database-template-instantiate.spec.ts` (new),
plus the unit-test extension above. The e2e drives the real browser through
the proxy (the F1 lesson — handler-import tests don't count).

**Coverage check:** the spec drives the REAL gallery surface: navigate to
`/templates`, click **Use template** on the Project tracker card, and assert
the browser **lands on the minted host page** (URL changes to
`/pages/<uuid>` and the cloned database renders). It cannot false-green
because (a) navigation only happens if `rootPageId` survives the
lib → route → client chain end-to-end — a 201 alone, or `rootDatabaseId`
alone, doesn't move the URL; (b) it also asserts the button has left the
"Working…" disabled state, which on main never happens (the existing unit
test at `instantiate.test.ts:227` false-greens precisely because it stops at
`rootDatabaseId`); (c) assertions key on the specific page minted in this
run, not row counts — the e2e dev DB accumulates state across runs.

**Failure modes verified:**

- **The repro, end-to-end:** Templates → Project tracker → "Use template" →
  assert URL becomes `/pages/<hostPageId>` and the host page renders the
  cloned database. (RED on main: URL stays on `/templates`.)
- **No stranded button:** after the click resolves, assert the card button is
  enabled and reads "Use template" again — not "Working…"/disabled. (RED on
  main: stuck forever per `templates-gallery.tsx:179-183`.)
- **Error path resets busy:** force the instantiate POST to fail (route
  intercept → 500) → inline error renders (`templates-gallery.tsx:110`) AND
  the button re-enables — proves the `finally`, not just the happy path.
- **Page-kind regression guard:** "Use template" on Meeting notes (kind
  `'page'`) still navigates to its root page (guard — no before; this path
  works today).
- **Unit (contract):** database-kind `instantiateTemplate` returns
  `rootPageId` equal to the inserted host page id, and the host page +
  database rows exist in the same transaction.

## B2 — Trash row "Untitled" fallback (title only — icon already works)

**Audit verdict: PARTIAL.** The title half is TRUE, the icon half is FALSE.
**Title:** there is no 'Untitled' fallback anywhere in the chain —
`listTrash()` selects raw `schema.pages.title` with no COALESCE/NULLIF
(`src/lib/pages/trash.ts:16-35`, select at line 19), the page wiring passes
`e.title` through untouched (`src/app/(app)/trash/page.tsx:10-23`), and the
row renders bare `{item.title}` (`src/components/trash-list.tsx:62`).
Untitled pages really do store `''`: `createPage` explicitly inserts
`title: input.title ?? ''` (`src/lib/pages/create.ts:55-58`, "born
title-less"), bypassing the DB column default `'Untitled'`
(`src/db/schema/pages.ts:39`); the PATCH route rejects empty titles
(`z.string().min(1)`, `src/app/api/pages/[pageId]/route.ts:23`) but never
backfills creation-time `''`. **Icon:** every trash row ALREADY renders an
icon — `trash-list.tsx:58-59` always renders `<InlineIcon value={item.icon}/>`,
and InlineIcon falls back to `'📄'` whenever the stored icon is null/empty
(`src/components/page-icon-inline.tsx:20-43` via the parseIcon null-guard at
`src/lib/pages/icon-format.ts:18-19`). In practice the icon is never even
null: `createPage` defaults it to `'📄'` (`src/lib/pages/create.ts:55-58`,
`DEFAULT_PAGE_ICON` at `src/lib/pages/default-icon.ts:48`). The archived
list mirrors the same missing-title pattern
(`src/components/archived-list.tsx:79-82`, doc comment says it "mirrors
TrashList").

**Premise corrections (audit, claimed ≠ actual):**

1. **Wrong location:** the trash list UI is NOT under
   `src/app/(app)/settings/workspace/trash` — that directory is the admin
   retention console only (retention-days form + empty-trash button,
   `src/app/(app)/settings/workspace/trash/page.tsx:21-46`). The actual list
   is the standalone route `src/app/(app)/trash/page.tsx` rendering
   `src/components/trash-list.tsx`.
2. **"No icon retention" is FALSE — do NOT build it.** The real rendered row
   for an untitled page is: icon emoji + EMPTY title line +
   'Deleted DATE TIME' (`trash-list.tsx:56-66`) — not "ONLY Deleted DATE
   TIME". Original icons are already preserved and rendered, with a `'📄'`
   fallback when missing.

**Gap to build (the delta only — title fallback, nothing else):**

Render **Untitled** when `item.title` is empty (recommend also trimming
whitespace-only titles). Decision: do it **client-side with i18n**, not the
seeded "server returns `title || 'Untitled'`" — a server-side coalesce in
`listTrash` would bake hardcoded English into the API. `trash-list.tsx`
currently has NO i18n hook (all strings hardcoded English, no
`useTranslations` import); wire `useTranslations` and add a key like
`trash.untitled` next to the existing conventions
(`messages/en.json:1076` `page.title.placeholder: 'Untitled'`;
`messages/en.json:157` `moveTo.untitled`, used as a render fallback in
`src/components/sidebar/move-to-picker.tsx:157`). Apply the same one-line
fallback to the mirrored archived list at
`src/components/archived-list.tsx:79-82`. The fallback is **display-only**:
the stored `''` title and the PATCH `min(1)` contract are untouched.

**i18n reminder:** new UI text → add the key to **all three** of
`messages/{en,es,ar}.json`; no hardcoded JSX strings (CI bans them).

**Files:**

- `src/components/trash-list.tsx` (primary — wire `useTranslations`,
  fallback at line 62)
- `src/components/archived-list.tsx` (mirror fix at lines 79-82)
- `messages/en.json`, `messages/es.json`, `messages/ar.json`
  (`trash.untitled` key)
- `src/lib/pages/trash.ts` (touch only if the trim is done server-side via
  NULLIF/empty-string coalesce; otherwise no change)

**Spec:** `tests/e2e/item-b2-trash-untitled-fallback.spec.ts` (new).

**Coverage check:** the spec drives the full chain the user sees: create a
page WITHOUT typing a title (so the DB stores `''` per `create.ts:57` — not
a fixture that injects 'Untitled'), delete it, navigate to `/trash` in the
real browser through the proxy, and assert the row for that specific page
shows the visible text "Untitled" plus its icon. It cannot false-green
because (a) it creates the empty-title state through the product (a seeded
'Untitled' string in the fixture would mask the bug); (b) it asserts
rendered row text, which on main is an empty title line
(`trash-list.tsx:62`) — RED; (c) it targets the row by the created page's
identity, not list position — the e2e dev DB accumulates rows across runs.

**Failure modes verified:**

- **The repro:** untitled page → delete → `/trash` row shows "Untitled"
  above 'Deleted {date}'. (RED on main: empty title line.)
- **Whitespace-only title:** page titled `"   "` → trash row also shows
  "Untitled" (trim asserted).
- **Real titles untouched:** page titled "Q3 notes" → trash row shows
  "Q3 notes", not the fallback.
- **Icon guard (already shipped — guard, no before):** page with a custom
  emoji icon → trash row renders that exact icon; untitled default page
  renders `'📄'` (the InlineIcon fallback path,
  `page-icon-inline.tsx:20-43`).
- **Mirror:** same untitled page archived instead of deleted → archived list
  row shows "Untitled" (`archived-list.tsx` fix verified, not just trash).
- **Display-only:** restore the untitled page → it opens with the editor's
  empty-title placeholder; no 'Untitled' string was written to the DB.

## Per-PR artifacts (gate — the tag does not happen without these)

Every Plan B PR description MUST include:

1. **Spec file path** under `tests/e2e/` (B1 also lists the
   `tests/lib/templates/instantiate.test.ts` extension).
2. **Spec output on main BEFORE the fix** — pasted, RED (guards state
   "guard — no before"; no fabricated befores).
3. **Spec output on branch AFTER the fix** — pasted, GREEN (×3 for e2e).
4. **Live-deploy verification** — navigate the repro path on the booted
   preview deployment; screenshot committed under
   `docs/superpowers/v0.10.2/artifacts/` and linked from the PR.
