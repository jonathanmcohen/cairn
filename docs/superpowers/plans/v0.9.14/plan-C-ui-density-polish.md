# v0.9.14 Plan C — UI density polish

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]). Prefix every shell command with `source ~/.zshenv && `.

## Goal

Five density / legibility items for the editor and sidebar. Three require real code changes (C1, C3, and the gate); two reduce to regression tests because the code was already shipped (C2 — StudyLink density triplet; C4 — new-page default Draft). C5 is a no-op: the cover banner and the page title are sequential DOM siblings, not overlaid, so there is no contrast problem to fix.

## Architecture

- **C1** — `src/components/sidebar.tsx` inline style + `tests/components/sidebar-default-width.test.tsx`.
- **C2** — regression test only: `tests/components/sidebar-density-study-link.test.tsx` already exists and passes; confirm it covers the density triplet. No source change needed.
- **C3** — `src/app/globals.css` (merge into the existing `.ProseMirror h1/h2/h3` block). New token `--cairn-block-gap` in the `@theme inline` block. New test `tests/styles/editor-block-spacing.test.ts` (source-assertion).
- **C4** — regression test only: `src/lib/pages/create.ts:48` already reads `ws?.defaultPageStatus ?? 'draft'`. New test `tests/lib/pages/new-page-default-draft.test.ts` (Testcontainers integration).
- **C5** — no-op confirmed: `CoverBanner` in `src/app/(app)/pages/[pageId]/page.tsx` renders before the `<PageIconPicker>` / `<PageTitleInput>` row; the title sits below the banner in normal document flow, never overlaid. No scrim needed.

## Tech Stack

- Next.js 16 App Router, TypeScript strict, Tailwind v4 CSS-first (`@theme inline` in `globals.css`)
- TipTap 3 editor; editing surface class is `.ProseMirror`
- Vitest v4 + Testcontainers v12 for integration; plain `readFileSync` source assertions for CSS/TSX
- Biome v2 lint/format — run `pnpm lint` after every edit

---

## Tasks

### C1 — Sidebar default width 224px → 240px

**Pre-check (already done):** `src/components/sidebar.tsx` line 28 reads `var(--cairn-sidebar-w, 14rem)`. `14rem` = 224px. Target is `15rem` = 240px. The persisted localStorage drag override is untouched; only the pre-hydration / never-resized default changes. The existing test `tests/components/sidebar-default-width.test.tsx` asserts `14rem` — it must be updated too.

- [ ] **C1-T1 — Update sidebar fallback and test (TDD red → green)**

  1. Open `tests/components/sidebar-default-width.test.tsx`. Replace the assertion so it expects `15rem` and does NOT contain `14rem`:

     ```ts
     // tests/components/sidebar-default-width.test.tsx
     import { readFileSync } from 'node:fs';
     import { join } from 'node:path';
     import { describe, expect, it } from 'vitest';

     const src = readFileSync(join(process.cwd(), 'src/components/sidebar.tsx'), 'utf8');

     describe('sidebar default width (C1 v0.9.14)', () => {
       it('falls back to 15rem (240px), matching Notion default', () => {
         expect(src).toContain('var(--cairn-sidebar-w, 15rem)');
         expect(src).not.toContain('var(--cairn-sidebar-w, 14rem)');
       });
     });
     ```

  2. Run test — it should **fail** (red):

     ```sh
     source ~/.zshenv && pnpm vitest run tests/components/sidebar-default-width.test.tsx
     ```

  3. Edit `src/components/sidebar.tsx`. Update the `style` prop and the comment above it:

     - Change `style={{ width: 'var(--cairn-sidebar-w, 14rem)' }}` to `style={{ width: 'var(--cairn-sidebar-w, 15rem)' }}`.
     - Update the adjacent comment: change `14rem (= 224px, #131; was 16rem/256)` to `15rem (= 240px, C1 v0.9.14; was 14rem/224 since #131)`.

  4. Run test — should **pass** (green):

     ```sh
     source ~/.zshenv && pnpm vitest run tests/components/sidebar-default-width.test.tsx
     ```

  5. Lint:

     ```sh
     source ~/.zshenv && pnpm lint
     ```

  6. Commit:

     ```sh
     git add src/components/sidebar.tsx tests/components/sidebar-default-width.test.tsx
     git commit -m "feat(sidebar): widen default fallback to 15rem/240px (C1 v0.9.14)"
     ```

---

### C2 — Sidebar text 13px (StudyLink density triplet) — regression only

**Pre-check result:** `StudyLink` already carries the full density triplet: `text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px]`, no bare `text-sm`. The test `tests/components/sidebar-density-study-link.test.tsx` already covers both assertions. No source change is required.

- [ ] **C2-T1 — Confirm existing test passes (no edits)**

  ```sh
  source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-study-link.test.tsx
  ```

  Expected: all assertions green. If any fail, investigate before proceeding — do not edit the test to make it pass without understanding the root cause.

  No commit needed. Record the green output as evidence.

---

### C3 — Editor block spacing (#141)

**Pre-check result:** `src/app/globals.css` has an existing `.ProseMirror` block (font-size + line-height) and a `.ProseMirror h1/h2/h3` block (font-size, font-weight, letter-spacing only). No margin rules exist anywhere on `.ProseMirror` selectors. The `@theme inline` block has no `--cairn-block-gap` token.

**Design decision — scope (REVISED after review):** `.ProseMirror` is a class ProseMirror applies at RUNTIME to its editor DOM node — and the public `/p/[slug]` reader renders `ReadOnlyView`, which also mounts a TipTap editor and therefore ALSO gets `.ProseMirror`. So a bare `.ProseMirror …` rule WOULD leak to the public reader (and in-app reader mode). To keep the change editor-only, every margin rule is scoped to `.ProseMirror[contenteditable="true"]`: TipTap sets `contenteditable="true"` only when `editable:true` (the editor), while `ReadOnlyView` is `editable:false` → `contenteditable="false"`, so it is excluded. The public `/p/*` rhythm (governed by `@plugin "@tailwindcss/typography"`) stays untouched. The `--cairn-block-gap` token lives in `@theme inline`/`:root` and is consumed only by these scoped rules.

- [ ] **C3-T1 — Write failing test first**

  Create `tests/styles/editor-block-spacing.test.ts`:

  ```ts
  // tests/styles/editor-block-spacing.test.ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

  describe('editor block spacing token (#141)', () => {
    it('defines --cairn-block-gap token at 6px', () => {
      expect(css).toMatch(/--cairn-block-gap:\s*6px/);
    });
  });

  describe('editor block spacing rules (#141)', () => {
    // All rules MUST be scoped to the editable surface
    // (.ProseMirror[contenteditable="true"]) so they do not leak to the public
    // /p/* read-only reader, which also carries the runtime .ProseMirror class.
    it('scopes the block-gap rule to the editable .ProseMirror surface', () => {
      expect(css).toContain('.ProseMirror[contenteditable="true"] > * + *');
      expect(css).toContain('var(--cairn-block-gap');
    });

    it('does NOT add bare (unscoped) .ProseMirror margin rules (would hit public reader)', () => {
      // guard against regression to the leaky selector
      expect(css).not.toMatch(/\.ProseMirror >\s*\*\s*\+\s*\*/);
    });

    it('adds h1 margin-bottom on the editable surface', () => {
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h1[^}]*margin-bottom/s);
    });

    it('adds h2 top + bottom margins on the editable surface', () => {
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h2[^}]*margin-top/s);
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h2[^}]*margin-bottom/s);
    });

    it('adds h3 top + bottom margins on the editable surface', () => {
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h3[^}]*margin-top/s);
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] h3[^}]*margin-bottom/s);
    });

    it('zeros paragraph margin on the editable surface', () => {
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] p[^}]*margin:\s*0/s);
    });

    it('adds ul/ol left indent on the editable surface', () => {
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] [uo]l[^}]*padding-left/s);
    });

    it('adds blockquote and pre vertical margins on the editable surface', () => {
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] blockquote[^}]*margin/s);
      expect(css).toMatch(/\.ProseMirror\[contenteditable="true"\] pre[^}]*margin/s);
    });
  });
  ```

  Run — should **fail** (red):

  ```sh
  source ~/.zshenv && pnpm vitest run tests/styles/editor-block-spacing.test.ts
  ```

- [ ] **C3-T2 — Add token and rules to globals.css**

  1. In `src/app/globals.css`, in the `@theme inline` block, append the new token after the `--cairn-prose-leading` line:

     ```css
     /* v0.9.14 C3 #141 — editor block-gap token. Controls the default sibling
        spacing in .ProseMirror. Heading-specific margins below override it. */
     --cairn-block-gap: 6px;
     ```

  2. After the existing `.ProseMirror h3 { ... }` closing brace, add the following block (do NOT duplicate the `.ProseMirror` font-size/line-height block — those rules already exist):

     ```css
     /* v0.9.14 C3 #141 — editor block spacing. Scoped to
        .ProseMirror[contenteditable="true"] — the EDITABLE surface only.
        IMPORTANT: `.ProseMirror` is a class ProseMirror applies at RUNTIME to
        BOTH the editable editor AND the read-only public reader (/p/[slug] uses
        ReadOnlyView, which also mounts a TipTap editor → also gets .ProseMirror).
        TipTap sets contenteditable="true" only when editable:true, so the
        [contenteditable="true"] attribute selector hits the editor and NOT the
        public reader (ReadOnlyView is editable:false → contenteditable="false").
        This keeps the public /p/* rhythm (governed by @tailwindcss/typography)
        untouched. Headings override the sibling gap via specificity + source order. */

     /* Default sibling gap for any block element inside the editor. */
     .ProseMirror[contenteditable="true"] > * + * {
       margin-top: var(--cairn-block-gap, 6px);
     }

     /* Heading-specific overrides. */
     .ProseMirror[contenteditable="true"] h1 {
       margin-bottom: 8px;
     }
     .ProseMirror[contenteditable="true"] h2 {
       margin-top: 24px;
       margin-bottom: 8px;
     }
     .ProseMirror[contenteditable="true"] h3 {
       margin-top: 16px;
       margin-bottom: 6px;
     }

     /* Paragraphs carry no extra margin; the sibling gap handles spacing. */
     .ProseMirror[contenteditable="true"] p {
       margin: 0;
     }

     /* Lists: no vertical margin; indent via padding-left only. */
     .ProseMirror[contenteditable="true"] ul,
     .ProseMirror[contenteditable="true"] ol {
       margin: 0;
       padding-left: 24px;
     }
     .ProseMirror[contenteditable="true"] li {
       margin: 2px 0;
     }

     /* Blockquotes and code blocks get a uniform 8px vertical rhythm. */
     .ProseMirror[contenteditable="true"] blockquote,
     .ProseMirror[contenteditable="true"] pre {
       margin: 8px 0;
     }
     ```

  3. Run test — should **pass** (green):

     ```sh
     source ~/.zshenv && pnpm vitest run tests/styles/editor-block-spacing.test.ts
     ```

  4. Lint + typecheck:

     ```sh
     source ~/.zshenv && pnpm lint && pnpm typecheck
     ```

  5. Commit:

     ```sh
     git add src/app/globals.css tests/styles/editor-block-spacing.test.ts
     git commit -m "feat(editor): add block spacing token + margin rules (.ProseMirror, C3 #141)"
     ```

---

### C4 — New-page default Draft — regression only

**Pre-check result:** `src/lib/pages/create.ts:48` reads `const defaultStatus = (ws?.defaultPageStatus ?? 'draft') as schema.PageStatus;`. The fallback is already `'draft'`. No source change needed. A regression test should lock this behavior.

- [ ] **C4-T1 — Write integration test**

  Create `tests/lib/pages/new-page-default-draft.test.ts`:

  ```ts
  // tests/lib/pages/new-page-default-draft.test.ts
  import { beforeAll, afterAll, describe, it, expect } from 'vitest';
  import { startPostgres, stopPostgres, getTestDb } from '../../helpers/db';

  // Prevent embed side-effect in tests
  process.env.CAIRN_DISABLE_EMBED_HOOK = '1';

  beforeAll(startPostgres);
  afterAll(stopPostgres);

  describe('createPage default status (C4 v0.9.14)', () => {
    it('uses draft when workspace has no explicit defaultPageStatus', async () => {
      const { createPage } = await import('@/lib/pages/create');
      const { insertTestWorkspaceAndUser } = await import('../../helpers/fixtures');
      const db = getTestDb();

      const { workspaceId, userId } = await insertTestWorkspaceAndUser(db);

      const page = await createPage(db, {
        workspaceId,
        createdBy: userId,
        title: 'regression check',
      });

      expect(page.status).toBe('draft');
    });
  });
  ```

  Run:

  ```sh
  source ~/.zshenv && pnpm vitest run tests/lib/pages/new-page-default-draft.test.ts
  ```

  Expected: green. If it fails because `insertTestWorkspaceAndUser` doesn't exist at that path, check `tests/helpers/fixtures.ts` or the equivalent helper, adjust the import, and re-run before committing. Do not alter the production code.

  Commit:

  ```sh
  git add tests/lib/pages/new-page-default-draft.test.ts
  git commit -m "test(pages): regression — createPage defaults to draft status (C4 v0.9.14)"
  ```

---

### C5 — Cover gradient overlay legibility — no-op

**Pre-check result:** In `src/app/(app)/pages/[pageId]/page.tsx`, `CoverBanner` (or `EditableCover`) renders first and produces a 200px `<div>` / `<img>` container with class `cairn-cover h-[200px] w-full`. Immediately after it, the icon + title + action-bar row is a separate `<div className="mb-6 flex flex-wrap items-center gap-2 ...">`. The title sits below the cover in standard block flow; there is no absolute/relative positioning that overlays the title on the cover image. Legibility is not a concern — no scrim is needed. No code changes. No test required beyond documenting this finding.

- [ ] **C5-T1 — Record finding, skip implementation**

  Confirm by reading `src/app/(app)/pages/[pageId]/page.tsx` lines 87–106. The `CoverBanner` / `EditableCover` and the title `<div>` are sequential siblings. No action required.

---

### Gate — Plan C verification

- [ ] **GATE-T1 — Run the full test suite**

  ```sh
  source ~/.zshenv && pnpm vitest run
  ```

  All tests must pass. Zero failures, zero skipped (unless pre-existing skips).

- [ ] **GATE-T2 — Lint and typecheck**

  ```sh
  source ~/.zshenv && pnpm lint && pnpm typecheck
  ```

  Biome: 0 errors. tsc: 0 errors.

- [ ] **GATE-T3 — Build check**

  ```sh
  source ~/.zshenv && pnpm build
  ```

  Must complete without error.

- [ ] **GATE-T4 — No push**

  Do not push the branch. The controller/human pushes after reviewing all Plan C commits.

---

## Per-item shipped verdict

| Item | Verdict | Action |
|------|---------|--------|
| C1 sidebar width 224→240px | **Needs change** — fallback is `14rem`/224px; change to `15rem`/240px + update test | Code edit + test update |
| C2 sidebar text 13px (StudyLink) | **Already shipped** — density triplet present; existing test covers it | Regression confirm only |
| C3 editor block spacing (#141) | **Needs change** — no margin rules exist on `.ProseMirror` selectors | New CSS + new test |
| C4 new-page default Draft | **Already shipped** — `?? 'draft'` fallback at `create.ts:48` since v0.9.9 K2 | Regression test only |
| C5 cover gradient overlay | **No-op** — title is below banner in DOM flow, not overlaid; no scrim needed | No code, no test |
