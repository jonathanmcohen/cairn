# Plan F — flashcards management (F1 + F2 + F3, all in v0.10.2)

> **HOLD until GO.**

Problem (user, verbatim): cards exist only as study queue. No list view, no
delete, no decks, no orphan handling when source page is trashed.

Three phases — **all three land in v0.10.2** (user decision 2026-06-12: no
deferrals; single release, single tag, single image). Internal ship order is
strictly **F1 → F2 → F3**: F2's deck-entity migration is additive on F1's
minimal decks table, and F3's stats read F1's `reps` column and audit rows.

### Closed by re-audit — none (0)

| Item | Verdict |
|------|---------|
| — | The single audited item (F1) is **PARTIAL**; no SHIPPED items to close. |

## F1 — flashcards management surface (v0.10.2)

**Audit verdict: PARTIAL.** The phase-1 foundation is shipped and must NOT be
rebuilt; everything user-facing beyond "study the due queue" is a gap.

Current state (audit evidence, 2026-06-12):

- **Schema** — two tables in `src/db/schema/flashcards.ts`, created by
  `drizzle/migrations/0045_flashcards.sql` (premise "0045?" CONFIRMED).
  `flashcard_cards` (lines 29-52): id uuid PK, page_id FK→pages ON DELETE
  CASCADE, workspace_id FK→workspaces CASCADE (denormalized), block_id text,
  front, back, deck_tag text NULLABLE, created_by, timestamps, index
  (page_id, block_id). `flashcard_reviews` (lines 60-81): composite PK
  (card_id, user_id) — per-user SM-2 state — ease real default 2.5, interval
  integer default 0, due_at default now(), last_reviewed_at, last_grade,
  index (user_id, due_at). **NOT present** (negative grep across src/,
  drizzle/, tests/): deck_id (only free-text `deck_tag`),
  source_orphaned_at, tags, suspended state, reps counter
  (`src/lib/flashcards/sm2.ts:55-58` infers stage from interval 0/1/>1).
- **Routes** — exactly three: `src/app/(app)/flashcards/study/page.tsx`
  (client study session: due queue, flip, Again/Hard/Good/Easy, `?deck=`
  filter), `src/app/api/flashcards/due/route.ts` GET,
  `src/app/api/flashcards/grade/route.ts` POST (zod cardId+grade 0-3,
  cross-workspace 404, SM-2 via scheduleNext, upserts flashcard_reviews).
  No /flashcards index, no decks route, no stats route, no per-card browse.
- **Sidebar** — both rows mounted at `src/components/sidebar-footer-nav.tsx:56-57`.
  "Review due" (`src/components/sidebar/review-due-counter.tsx:34-45`) is
  conditional — renders null when 0 due (line 32) — and its label is
  **hardcoded English** (line 41). "Study flashcards"
  (`src/components/sidebar/study-link.tsx:13-24`) is i18n'd
  (`messages/en.json:754`). Also shipped: command-palette "Study flashcards"
  (`src/lib/palette/actions.ts:79-81`), empty state
  (`src/components/empty-state/variants.tsx:89-98`), daily 09:00 UTC due
  cron (`src/server/cron-register.ts:131-178`,
  `src/lib/flashcards/notify-due.ts`).
- **Trash/delete** — soft delete (`src/lib/pages/delete.ts:44-56`) only sets
  `pages.deleted_at`; NO flashcard cleanup anywhere in the trash path. The
  due queue (`src/lib/flashcards/due-queue.ts:47-69`) never joins pages and
  has no deleted_at filter, so **cards from trashed pages remain in the
  study queue, the sidebar count, and the daily due notification scan**.
  Permanent delete (`src/lib/pages/trash.ts:95-97`,
  `src/lib/pages/auto-purge.ts:45`) removes cards via the page_id FK ON
  DELETE CASCADE (`0045_flashcards.sql:27`); reviews cascade via card_id FK
  (0045:30). Removing a flashcard block from a live page hard-deletes its
  card + review history on next save (`src/lib/flashcards/reconcile.ts:45-57`)
  — no orphan grace period exists anywhere.
- **Export** — the workspace archive (`src/lib/export/workspace-archive.ts:47-58`)
  loads only pages, databases, files; zero flashcard references in
  `src/lib/export/`. flashcard_cards rows and ALL SM-2 review state are NOT
  in the zip. (The full-DB pg_dump backup `src/lib/backups/jobs.ts:139-153`
  does capture the tables — that's the .dump bundle, not the archive.)
- **Creation** — HYBRID and already correct: `/flashcard` slash command
  (`src/components/editor/slash-extension.ts:812-836`) → modal
  (`editor-dialogs.tsx:70-75`) → atom node (`blocks/flashcard-node.ts`);
  canonical flashcard_cards row materialized per block on every save, REST
  path via reconcileFlashcards (`src/lib/pages/update.ts:114-124`), collab
  path via reconcileFlashcardsRaw (`src/lib/flashcards/reconcile-raw.ts`),
  both upserting keyed (page_id, block_id) (`upsert-card.ts:25-64`).

### Premise corrections (claimed vs. actual)

1. **"No delete" is half-wrong.** Card delete exists today — destructively:
   deleting the flashcard block from its page hard-deletes the card AND its
   review history on next save (`reconcile.ts:45-57`). The real gap is a
   *managed* delete (typed confirmation, undo, audit) and a non-destructive
   block-removal path.
2. **"Unresolvable source_page_id" cannot occur on current installs.** The
   page_id FK is ON DELETE CASCADE (`0045_flashcards.sql:27`), so a card
   never outlives its page. The first-boot backfill scan will report
   **"Cards orphaned: 0"** everywhere — the orphan population only starts
   accruing AFTER this migration flips the FK semantics (below). The audit
   line still ships (it proves the scan ran), but expect N=0.
3. **"Page → Trash keeps cards un-orphaned" is currently TRUE but leaky:**
   trashed-page cards today remain due, counted, and notified
   (`due-queue.ts:47-69` and `notify-due.ts` never join pages). F1 keeps
   them un-orphaned per scope, but must hide them from study/count/notify
   until the page is restored.
4. **"Reps" column has no source data.** There is no reps counter anywhere;
   sm2.ts infers learning stage from interval. `reps` is a NEW column on
   flashcard_reviews, backfilled to 0 (true history is unrecoverable);
   incremented on every grade going forward.
5. **`deck_id` needs a decks table in F1, not first in F2.** A nullable FK
   can't reference nothing. F1 ships a *minimal* decks table (id,
   workspace_id, name, timestamps) seeded "Default" per workspace; F2's
   richer columns (icon, color, parent_deck_id, limits) land as an additive
   migration later in this same release. The existing free-text `deck_tag`
   values are backfilled into decks by distinct name; `deck_tag` is kept
   (read-compat) but deprecated.
6. **i18n debt in the surface being replaced:** the "Review due" label is
   hardcoded English (`review-due-counter.tsx:41`) and the row vanishes at
   0 due (line 32). Both die with the sidebar replacement — the new
   Flashcards parent is always visible and fully keyed.

### Gap to build (delta only — foundation above is NOT rebuilt)

1. **Migration `drizzle/migrations/0076_flashcards_manage.sql`** (next free
   number per audit):
   - NEW `flashcard_decks` (minimal: id, workspace_id FK CASCADE, name,
     timestamps, unique (workspace_id, name)); seed "Default" per existing
     workspace; backfill distinct `deck_tag` values as decks.
   - NEW columns on flashcard_cards: `deck_id` uuid NULL FK→flashcard_decks
     (backfill from deck_tag by name, else Default), `source_orphaned_at`
     timestamptz NULL, `tags` text[] NOT NULL default '{}', `suspended_at`
     timestamptz NULL.
   - NEW column on flashcard_reviews: `reps` integer NOT NULL default 0.
   - **FK semantics change:** page_id becomes nullable; ON DELETE CASCADE →
     ON DELETE SET NULL, app code stamps `source_orphaned_at` on permanent
     delete (trash.ts hard-delete path + auto-purge.ts). Without this, the
     scope's "permanent delete sets source_orphaned_at" is unimplementable.
   - First-boot backfill scan + migration journal + audit line
     "Cards orphaned: N" (N=0 expected — premise correction 2).
   - Backfill every behavior-changing column on existing rows (the A3
     lesson, inherited via v0.10.0 gates).
2. **Trash/orphan semantics** (decisions locked here):
   - Page → Trash: cards stay un-orphaned but leave the due queue, sidebar
     count, and notify-due scan (pages join with deleted_at filter in
     `due-queue.ts` and `notify-due.ts`); restore returns them untouched.
   - Permanent delete (manual or auto-purge): `source_orphaned_at = NOW()`,
     page_id NULL; review history preserved; card appears in /flashcards/orphans.
   - Block removed from a live page: reconcile.ts / reconcile-raw.ts switch
     from hard delete to orphan-mark (same fields) — review history is no
     longer destroyed on save. Orphaned cards are excluded from the due
     queue until resolved.
   - Orphan resolutions: **reattach** (search picker → sets page_id, clears
     flag), **keep standalone** (clears flag only; card studies normally
     with no source page), **delete** (hard remove + audit).
3. **Routes** (all under the authed app shell, workspace-scoped,
   cross-workspace 404 per house pattern):
   - `/flashcards` — overview: due/new/mature counts + recent activity. NEW.
   - `/flashcards/study` — refactor of the existing page (moves under the
     new section nav; behavior unchanged). EXISTS — refactor only.
   - `/flashcards/manage` — list + filter + search + bulk select. Columns:
     Front / Back / Deck / Tags / Source page (link, or blocked-icon when
     trashed/orphaned) / Due / State / Interval / Ease / Reps / Last
     reviewed. Filters: deck, tag, state (new/learning/review/suspended),
     due range, source-page-exists, search front/back. NEW.
   - `/flashcards/orphans` — orphan list + the three resolutions. NEW.
   - Supporting API routes for list/mutate (`src/app/api/flashcards/…`),
     reusing due-queue/sm2 lib helpers; business logic in `src/lib/flashcards/`
     (db-injected, unit-testable) per house convention.
4. **Bulk operations** (manage): move to deck, add/remove tags,
   suspend/unsuspend, reset SM-2 (ease 2.5 / interval 0 / reps 0 / due
   now), reattach to page, delete (typed confirmation + 10s undo toast —
   undo restores card AND review rows), export selected to .csv.
   **Per-card:** edit front/back (writes through to the source block when
   attached — reuse the upsert keying), change deck, edit tags, suspend,
   reset, reattach, open source, delete.
5. **Audit log entries:** delete, bulk delete, reset, reattach — via the
   existing workspace audit-log helper (same pattern as webhook/SSO audits).
6. **Sidebar:** replace the two rows at `sidebar-footer-nav.tsx:56-57` with
   an expandable **Flashcards** parent (icon + due-count badge, always
   visible — fixes the renders-null-at-0 behavior) with children **Due
   now** / **Manage** / **Orphans**. `review-due-counter.tsx` and
   `study-link.tsx` are absorbed/retired. Update the palette action target
   if the study URL moves.
   **Cross-reference:** this supersedes the sidebar-footer rework slices of
   **Plan S — S9 and S17**. Plan S must not restyle or re-shuffle the two
   old flashcard rows; sequence F1's sidebar PR first, or land S9/S17 with
   the flashcard rows carved out. State the resolution in whichever PR
   merges second.
7. **Backup integration:** add `flashcards.json` to the workspace archive
   zip (`workspace-archive.ts`) — deck metadata, per-card rows incl. tags /
   suspended / orphan flags, per-card per-user SM-2 state (ease, interval,
   reps, due_at, last_grade, last_reviewed_at). Importer restores deck
   mapping **by name** and review state keyed (card, user-email→id),
   reconciling against cards rebuilt from page content (the reconcile
   upsert keying (page_id, block_id) is the join point).
8. **i18n:** every new UI string in `messages/{en,es,ar}.json` — no
   hardcoded JSX strings (CI bans them). Includes the resurrected "Review
   due"/"Due now" label (currently hardcoded, premise correction 6),
   section nav, manage columns, filter labels, bulk-action labels,
   typed-confirmation copy, undo toast, orphan actions, empty states.

### Files

- `src/db/schema/flashcards.ts` · `drizzle/migrations/0076_flashcards_manage.sql` (NEW)
- `src/lib/flashcards/due-queue.ts` · `notify-due.ts` · `reconcile.ts` ·
  `reconcile-raw.ts` · new `manage.ts` / `orphans.ts` / `decks.ts` helpers
- `src/lib/pages/delete.ts` · `src/lib/pages/trash.ts` · `src/lib/pages/auto-purge.ts`
  (orphan-stamp on hard delete)
- `src/app/(app)/flashcards/page.tsx` (NEW) · `study/page.tsx` (refactor) ·
  `manage/page.tsx` (NEW) · `orphans/page.tsx` (NEW) ·
  `src/app/api/flashcards/…` (new list/mutate routes)
- `src/components/sidebar-footer-nav.tsx` · retire
  `src/components/sidebar/review-due-counter.tsx` + `study-link.tsx` →
  new `src/components/sidebar/flashcards-nav.tsx`
- `src/lib/export/workspace-archive.ts` + importer counterpart
- `src/lib/palette/actions.ts` (target check)
- `messages/en.json` · `messages/es.json` · `messages/ar.json`

### Spec

- `tests/e2e/item-F1-flashcards-manage.spec.ts` — manage list, filters,
  bulk ops, typed-delete + undo, per-card edit, CSV export.
- `tests/e2e/item-F1-flashcards-orphans.spec.ts` — trash/permanent-delete/
  block-removal semantics + the three orphan resolutions + sidebar parent.
- `tests/integration/flashcards-migration-0076.test.ts` — justification for
  the non-e2e layer: the backfill scan, deck_tag→deck backfill, FK
  semantics flip, and "Cards orphaned: N" journal line run at migration
  time inside the container entrypoint; e2e cannot observe a migration
  against a pre-seeded old-schema DB. Testcontainers Postgres applies
  0001-0075, seeds legacy rows (incl. deck_tag values and a card on a
  later-hard-deleted page), applies 0076, asserts column state + journal +
  audit line.
- Archive round-trip is asserted inside the manage spec (export → wipe →
  import → SM-2 state intact), driving the real export/import UI.

### Coverage check

Both e2e specs drive the real browser surface **through the proxy**
(handler-import tests don't count — the v0.10.0 F1 lesson) against the
seeded dev stack: they create cards via the real `/flashcard` slash flow,
grade via the real study UI, then assert manage-table cells, sidebar badge
text, and orphan-view contents — every assertion is downstream of the DB
rows the mutations wrote, so a stubbed or short-circuited handler cannot
green them. The trash/orphan scenarios assert the *absence* of cards from
the due queue and the *presence* of review history after deletion — both
RED on main today (due-queue.ts has no pages join; the FK cascade destroys
history), so the specs cannot pre-pass. e2e hygiene: unique per-run
fixture names (the dev DB persists across runs) and no reliance on
clicking off-screen dropdown items (known long-dropdown overflow trap).
The migration test runs against a real old-schema Postgres, not mocks.

### Failure modes verified

- Migration on a populated legacy DB: deck_tag values become decks; cards
  with NULL deck_tag land in seeded "Default"; reps backfilled 0; journal +
  "Cards orphaned: 0" audit line present (premise correction 2).
- Trash a page with due cards → cards leave due queue, sidebar count, and
  notify-due scan output (RED on main: `due-queue.ts:47-69` never joins
  pages); restore the page → cards return, schedule untouched, still
  un-orphaned.
- Permanently delete a page → its cards get `source_orphaned_at`, page_id
  NULL, review rows SURVIVE (RED on main: FK cascade at
  `0045_flashcards.sql:27` deletes them), and appear in /flashcards/orphans.
- Delete a flashcard block from a live page, save → card orphan-marked, NOT
  destroyed; review history intact (RED on main: `reconcile.ts:45-57` hard
  delete).
- Orphan resolutions: reattach via search picker → source link works, card
  re-enters due queue; keep standalone → flag cleared, studies with no
  source; delete → gone + audit row.
- Bulk delete: wrong typed confirmation → nothing deleted; correct text →
  deleted + audit rows; undo within 10s restores cards AND review state;
  after 10s the toast is gone and rows stay deleted.
- Suspend → card leaves due queue and badge count; unsuspend → returns with
  interval/ease/due intact. Reset → ease 2.5 / interval 0 / reps 0 / due
  now + audit row.
- Filters compose: deck + state + due-range + front/back search +
  source-page-exists each narrow the table; suspended cards only appear
  under the suspended state filter.
- Archive round-trip: zip contains flashcards.json (RED on main:
  `workspace-archive.ts:47-58` has zero flashcard refs); import into a
  fresh workspace restores decks by name and per-user SM-2 state matching
  pre-export values.
- Sidebar: Flashcards parent visible at 0 due (RED on main:
  `review-due-counter.tsx:32` renders null), badge updates after grading,
  three children navigate; labels resolve from messages in en, es, and ar
  locales — no hardcoded JSX strings (CI gate).
- Cross-workspace card id in manage/mutate APIs → 404 (not 403), matching
  the existing grade-route behavior.
- CSV export of a bulk selection contains exactly the manage columns for
  exactly the selected rows.

## F2 — decks (v0.10.2, ships after F1)

**Audit verdict: GAP** (foundation note: only free-text `deck_tag` exists
today, `src/db/schema/flashcards.ts:29-52`; F1 converts it to a minimal
`flashcard_decks` table — F2 builds on that, premise correction 5).

### Gap to build

1. **Migration `drizzle/migrations/0077_flashcard_decks_full.sql`** —
   additive on F1's minimal table: `icon` text NULL, `color` text NULL,
   `parent_deck_id` uuid NULL self-FK (manual SQL — Drizzle can't model
   self-FKs in the callback form, house gotcha), `default_new_per_day`
   integer NULL, `default_review_limit` integer NULL, `ease_start` real
   NULL (NULL = inherit workspace default). Cycle guard on reparent lives
   in app code (same approach as the pages tree). Seed "Default" on
   workspace create (extend the existing workspace-create seeding path —
   F1 seeds it for *existing* workspaces via backfill; F2 wires creation).
2. **`/flashcards/decks`** — tree view (reuse the pages-tree interaction
   idiom, not the virtualizer unless deck counts demand it) with
   drag-to-reparent, per-deck counts (new / learning / review / mature),
   inline rename, icon + color pickers.
3. **Per-deck options:** override workspace defaults (new-per-day,
   review-limit, starting ease); "Study this deck" → `/flashcards/study?deck=<id>`
   (the study page's existing `?deck=` filter param is the join point —
   today it filters `deck_tag`; F2 switches it to deck_id).
4. **Deck lifecycle:** Move all cards to … · Merge into … (re-points
   deck_id, deletes source deck) · Delete (cascade prompt: choose
   "move cards to Default" or "delete N cards" — typed confirmation reuses
   the F1 gate; audit rows for merge/delete).
5. **Manage view:** bulk "Move to deck" upgrades from flat select to the
   deck tree picker.
6. **`/flashcard` editor block** gains a deck picker on insert (default
   "Default") and becomes a **display-only reference to the canonical
   card record** — front/back edits in manage write through to the block,
   block edits write through to the card, synced via the existing editor
   websocket (Hocuspocus) path. This inverts F1's block-is-source-of-truth
   reconcile direction: `reconcile.ts`/`reconcile-raw.ts` stop upserting
   front/back from content and instead resolve the block's card-id
   reference (keep (page_id, block_id) as the legacy join for old content).
   **Yjs caution (house memory): computed doc changes must go through the
   editor (`setContent`), never `Y.applyUpdate` of a fresh Y.Doc.**
7. **Sidebar:** add child **Decks** under the F1 Flashcards parent.
8. **i18n:** all new strings in `messages/{en,es,ar}.json`.

### Files

- `drizzle/migrations/0077_flashcard_decks_full.sql` (NEW) · `src/db/schema/flashcards.ts`
- `src/lib/flashcards/decks.ts` (grown from F1) · `due-queue.ts` (deck_id filter)
- `src/app/(app)/flashcards/decks/page.tsx` (NEW) + `src/app/api/flashcards/decks/…` (NEW)
- `src/components/editor/blocks/flashcard-node.ts` · `editor-dialogs.tsx`
  (deck picker) · `src/lib/flashcards/reconcile.ts` · `reconcile-raw.ts`
- `src/components/sidebar/flashcards-nav.tsx` · `messages/{en,es,ar}.json`

### Spec

- `tests/e2e/item-F2-decks.spec.ts` — create/rename/reparent/merge/delete
  decks, per-deck study session, bulk move via tree picker.
- `tests/e2e/item-F2-block-deck-sync.spec.ts` — block insert with deck
  picker; edit front in manage → block updates in the open editor; edit
  block → manage row updates (drives the real websocket, two contexts).
- Migration backfill assertions extend the F1 migration test file pattern
  (`tests/integration/flashcards-migration-0077.test.ts`).

### Coverage check

Both specs drive the real browser through the proxy. The sync spec opens
the SAME page in two contexts (the collab idiom from the presence specs)
so a reconcile shortcut that only works on save cannot green it. Deck
delete-with-cards asserts the chosen disposition against manage-table
contents — DB-row downstream, not toast text. Reparent cycle attempt
(drag a parent into its own child) must be rejected — asserted via the
tree's unchanged structure after the drop.

### Failure modes verified

- Merge deck A into B: A's cards show deck B in manage; A gone; audit row;
  SM-2 state untouched.
- Delete deck with "move to Default": counts shift to Default; with
  "delete N cards": typed gate, cards + reviews gone, audit row.
- Reparent cycle rejected (parent → own descendant).
- Per-deck override respected by the study queue (new-per-day cap honored
  in a seeded session); NULL override falls back to workspace default.
- Block↔card sync: front edited in manage appears in the open editor
  without reload; block deleted → F1 orphan semantics still hold (not
  hard-delete).
- Old content (blocks created pre-F2, no card-id attr) still resolves via
  the (page_id, block_id) legacy join — no dead blocks after upgrade.
- `?deck=` study filter: deck with 0 due renders the existing empty state.

## F3 — stats + .apkg export + workspace settings (v0.10.2, ships last)

**Audit verdict: GAP** (no stats surface, no Anki export, no flashcards
settings section anywhere — F1's `reps` column and audit rows are the data
feed; that is why `reps` lands in migration 0076).

### Gap to build

1. **`/flashcards/stats`** — panels, all computed from `flashcard_reviews`
   (+ F1 audit rows for review-event history): daily reviews sparkline
   (last 30d), retention % (rolling 30d: grades ≥ Good ÷ total),
   card-maturity histogram (new / learning / young (interval < 21d) /
   mature), GitHub-style heatmap calendar (365d), per-deck performance
   table, forecast of projected reviews next 7 / 30 days from current
   `due_at` distribution. **Decision locked: render with the existing
   in-repo SVG/chart approach used by the storage/health admin panels — no
   new chart dependency.** Review-event history beyond last_reviewed_at
   needs a `flashcard_review_events` append-only table (card_id, user_id,
   grade, reviewed_at) — added in migration `0078_flashcard_stats.sql`,
   populated going forward; panels state "since v0.10.2" for cold installs
   (pre-upgrade history is unrecoverable — same honesty rule as reps).
2. **`.apkg` Anki export** — deck tree + cards + per-user SM-2 state in
   Anki-compatible form. An .apkg is a zip (archiver — already a dep)
   containing an SQLite db. **Dependency decision required at GO:**
   `sql.js` (wasm, no native build) preferred over better-sqlite3 (native,
   pnpm allowBuilds friction) — flag in the PR if the choice changes.
   Scheduling mapping documented in the export: SM-2 ease×1000 → Anki
   factor, interval days → ivl, suspended → queue -1, orphans exported
   under their deck with a `cairn-orphan` tag.
3. **`.csv` extended** with stats columns (reps, retention contribution,
   last_grade).
4. **Settings → Workspace → Flashcards** (new section + nav child under
   Workspace): default deck for new cards, new cards/day (default 20),
   review limit/day (default 200), starting ease (default 2.5), leech
   threshold (lapses before auto-tag `leech`), daily reminder time (only
   when SMTP configured — the existing notify-due cron
   (`src/server/cron-register.ts:131-178`) gains per-workspace send-time).
   Stored in a `workspace_flashcard_settings` row (part of 0078); deck
   overrides (F2) take precedence.
5. **Leech handling:** grade Again on a card ≥ threshold times (counted
   from review events) → auto-add `leech` tag + suspend; audit row.
6. **Sidebar:** add child **Stats** under the Flashcards parent.
7. **i18n:** all new strings ×3 locales.

### Files

- `drizzle/migrations/0078_flashcard_stats.sql` (NEW: review_events +
  workspace_flashcard_settings) · `src/db/schema/flashcards.ts`
- `src/lib/flashcards/stats.ts` (NEW) · `apkg.ts` (NEW) · `sm2.ts` (leech
  hook) · `notify-due.ts` (per-workspace time)
- `src/app/(app)/flashcards/stats/page.tsx` (NEW) ·
  `src/app/api/flashcards/stats/route.ts` · `…/export/apkg/route.ts` (NEW)
- `src/app/(app)/settings/workspace/flashcards/page.tsx` (NEW) +
  `src/components/settings/sidebar.tsx` (nav child)
- `src/components/sidebar/flashcards-nav.tsx` · `messages/{en,es,ar}.json`

### Spec

- `tests/e2e/item-F3-stats.spec.ts` — seed graded reviews via the real
  study UI, assert sparkline/histogram/heatmap/forecast numbers derive
  from them; settings form round-trip; leech auto-suspend.
- `tests/lib/flashcards/apkg.test.ts` — layer justification: .apkg
  correctness is a binary-format contract, not a browser surface; the
  test unzips the produced file, opens the SQLite db, and asserts decks /
  notes / cards / scheduling fields. The e2e spec still clicks the real
  Export button and asserts a non-empty download (the UI wiring half).
- Migration test `tests/integration/flashcards-migration-0078.test.ts`.

### Coverage check

Stats numbers are asserted against arithmetic from the seeded grades (the
spec computes expected retention/forecast from its own inputs), so a
hardcoded or cached panel cannot green. The apkg unit test reads back the
actual SQLite bytes — a stub zip fails. Settings round-trip asserts the
cron sees the new send-time (unit-level on the cron query) and the study
queue honors new-per-day. Heatmap asserts cell counts, not pixels.

### Failure modes verified

- Stats page on a cold install (zero events): every panel renders its
  empty state, no NaN/divide-by-zero; "since v0.10.2" caveat visible.
- Retention math: seeded 3 Good + 1 Again → 75% (rolling window boundary:
  events 31 days old excluded).
- Forecast counts only non-suspended, non-orphaned cards.
- apkg: re-import into real Anki structure (assert against the known
  schema: col/notes/cards tables present, due/ivl/factor populated,
  suspended cards queue=-1, deck hierarchy preserved via `::` names).
- Leech: (threshold) Again grades → tag + suspended + audit; threshold-1
  → untouched.
- Reminder time without SMTP: field disabled with explanatory hint (the
  SMTP-off hardening rule); with SMTP: cron honors per-workspace time.
- Per-deck table matches manage-view counts for the same filters.

## Per-PR artifacts (gates inherited from v0.10.0, unchanged)

Every Plan F PR description MUST include, or the tag does not happen:

1. **Spec file path** under `tests/e2e/` (justified exceptions, layer
   rationale above: the three migration integration tests and the .apkg
   binary-format unit test).
2. **Spec output on main BEFORE the change** — pasted, RED (the four
   RED-on-main scenarios called out above; guards state "guard — no
   before"; no fabricated befores).
3. **Spec output on branch AFTER** — pasted, GREEN, **×3 for e2e**.
4. **Live-deploy verification** — navigate the real path on the booted
   preview deployment; screenshot committed under
   `docs/superpowers/v0.10.2/artifacts/`.

i18n gate applies to every PR that adds UI text: keys in
`messages/{en,es,ar}.json`, no hardcoded JSX strings (CI bans them).
