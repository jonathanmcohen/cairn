# v0.9.11 Plan U — Notion polish (PATCH set)

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Ship the **PATCH-verdict** items from `docs/superpowers/v0.9.11/polish-audit.md` on `patches/v0.9.11` — the a11y-safe, token/class-level Notion-polish wins that need no structural component rewrite. Seven slices, all CSS / className / tiny-component work:

- **#1 Typography (audit row 1):** add a tokenized prose heading scale (H1 1.875rem/600, H2 1.5rem/600, H3 1.25rem/600, all `tracking-[-0.01em]`) + a base measure (`--cairn-prose-base: 16px`, `--cairn-prose-leading: 1.6`) to the `@theme`/scoped CSS in `globals.css`; tighten the editor heading rendering; **ship Inter as the sans via `next/font/google` with `display: 'swap'`** wired into `--cairn-font-family`.
- **#3 Status-color token swaps (audit row 3):** replace raw `bg-amber-500`/`bg-emerald-500` (`editor.tsx`) and `text-green-700`/`text-red-700` (`suggestion-toolbar.tsx`) with the existing semantic `warning`/`success`/`destructive` tokens (single-accent discipline).
- **#7 Block-handle transition (audit row 7):** add `transition-colors duration-150` to the `+`/grip hover buttons in `drag-handle.tsx`.
- **#8 Page-cover bottom hairline (audit row 8):** add a 1px `border-b` under the cover banner via the shared `.cairn-cover` rule in `globals.css`.
- **#10 Button press-scale (audit row 10):** add `active:scale-[0.98]` + `motion-reduce:active:scale-100` to `buttonVariants`; pin the sheet enter/exit timings to the 150–300ms band.
- **#11 Empty-state icons (audit row 11):** add icons to the four icon-less variants (`EmptySearch`, `EmptyInbox`, `EmptyBacklinks`, `EmptyRecents`) in `empty-state/variants.tsx`.
- **#16 Skeleton loaders (audit row 16):** add `src/components/ui/skeleton.tsx` and apply it to three client spinner/text-load surfaces (notifications drawer, search palette, cover-picker upload).

**Architecture:** All work is presentational. (1) Typography lives in `src/app/globals.css` — the `:root`-level `--cairn-font-family` (line 157) is the per-user-theme font var that the body applies via `font-family: var(--cairn-font-family)` (line 214); we prepend the Inter `next/font` CSS variable to that stack so Inter loads (swap) with the existing `system-ui` fallback chain intact. The TipTap editing surface is the `.ProseMirror` element rendered with `prose prose-sm sm:prose-base dark:prose-invert max-w-none` (`editor.tsx:103`); we add a scoped `.ProseMirror` heading-scale CSS block (sibling to the existing rules in `globals.css`) rather than fight `--tw-prose-*` defaults. (2) Status colors: the shadcn token chain already defines `--color-success`/`--color-warning`/`--color-destructive` in the `@theme inline` block (`globals.css:80-85`), so `bg-warning`/`bg-success`/`text-success`/`text-destructive` are already-valid utilities — this is a literal find/replace of raw Tailwind palette classes. (3) Drag-handle, (4) cover, (5) button, (6) empty-state are single-className/element edits. (7) Skeleton is a new ~10-line `ui/` primitive plus three call-site swaps. **No schema, route, or logic change; no migration** (latest applied stays 0068).

**Tech Stack:** Next.js 16 App Router (React 19, TS6, `proxy.ts` auth gate, `output: 'standalone'`), `next/font/google` (self-hosts/bundles the font at build — no runtime CDN fetch, CSP-safe), Tailwind v4 (CSS-first `@theme` in `src/app/globals.css`, **no `tailwind.config.*`**) + shadcn/ui (new-york) with `tw-animate-css`, `lucide-react` icons, Biome v2 (0 errors), Vitest 4 + Testcontainers (component/DOM tests run under a per-file `// @vitest-environment jsdom` pragma with `@testing-library/react`; pure CSS/source-text assertions run under the default `node` env), Playwright + `@axe-core/playwright` for the e2e a11y gate (`pnpm test:a11y`). Shell commands MUST be prefixed `source ~/.zshenv &&` (Homebrew/node/pnpm are not on PATH otherwise). All work lands on `patches/v0.9.11` as part of the single v0.9.11 PR. **HOLD for GO before merge; do not push.**

**A11y invariant (load-bearing for the whole plan):** every change here is font-size, color, transition-timing, a sub-pixel `active:scale`, an icon, or a non-interactive skeleton div — **none alters an interactive element's box height**. The drag-handle `+`/grip buttons stay `h-6 w-6` (they are hover-only desktop mouse affordances, unchanged by adding a transition); the empty-state CTAs keep their `min-h-11` (44px) floor (`empty-state.tsx:41-48`); `active:scale-[0.98]` is a transient transform that does not change layout box size and is disabled under `prefers-reduced-motion` via `motion-reduce:active:scale-100`. The global `@media (prefers-reduced-motion: reduce)` block (`globals.css:275-285`) already clamps all transition/animation durations, so the new transitions and the sheet timing pins degrade gracefully. The final task re-runs `pnpm test:a11y` as the safety net.

---

## U1 — Ship Inter via `next/font` + wire into the font stack (#1)

**Cause:** `globals.css:157-158` sets `--cairn-font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;` — a pure system stack with no branded sans. `package.json` has **no** font dependency and `src/app/layout.tsx` makes **no** `next/font` call. The scope wants Inter shipped as the sans with `display: swap`.

> **Divergence note (recorded for the reviewer):** `polish-audit.md` row 1 says *"do not add Inter unless bundled."* This plan satisfies that caveat: `next/font/google` **self-hosts** the font at build time (it is bundled into the standalone output, not fetched from a CDN at runtime), so the "unless bundled" condition is met and it is CSP-safe. We follow the explicit v0.9.11 scope (ship Inter) over the audit's conservative default.

**Fix:** Instantiate `Inter` from `next/font/google` in `layout.tsx` with `subsets: ['latin']`, `display: 'swap'`, and a CSS variable `--font-inter`; attach that variable's class to `<html>`. Then prepend `var(--font-inter)` to the `--cairn-font-family` stack in `globals.css` so Inter renders first with the system chain as fallback.

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `package.json` / `pnpm-lock.yaml` (adds `next/font` — see step 1)
- Create: `tests/components/font-inter-wired.test.ts`

Steps:

- [ ] `next/font` ships **inside** the `next` package (no separate dep to install) — confirm it resolves: `source ~/.zshenv && node -e "require.resolve('next/font/google')" && echo OK`. (If this prints `OK`, no `package.json` change is needed; `next/font` self-hosts the Google font at build.)
- [ ] Write a failing source-text test `tests/components/font-inter-wired.test.ts` (default `node` env — asserts wiring, not pixels):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

  describe('Inter font wiring (#1)', () => {
    it('instantiates Inter from next/font/google with display: swap', () => {
      expect(layout).toMatch(/from ['"]next\/font\/google['"]/);
      expect(layout).toMatch(/Inter\(/);
      expect(layout).toMatch(/display:\s*['"]swap['"]/);
      expect(layout).toMatch(/variable:\s*['"]--font-inter['"]/);
    });
    it('prepends the Inter variable to the cairn font stack', () => {
      expect(css).toMatch(/--cairn-font-family:\s*\n?\s*var\(--font-inter\)/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/font-inter-wired.test.ts`.
- [ ] Impl in `src/app/layout.tsx`: add the import + instance near the top (after the existing imports, before `metadata`), and apply `inter.variable` to `<html>`:
  ```tsx
  import { Inter } from 'next/font/google';
  // ...
  // v0.9.11 #1 — ship Inter as the branded sans. next/font self-hosts the font
  // at build (bundled into the standalone output, no runtime CDN fetch → CSP-safe)
  // and `display: 'swap'` shows the system fallback until Inter loads (no FOIT).
  // Exposed as --font-inter; globals.css prepends it to --cairn-font-family.
  const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
  ```
  Then add the class to the root element (keep the existing `lang`/`dir`/`suppressHydrationWarning`):
  ```tsx
  <html lang={locale} dir={dir(locale)} className={inter.variable} suppressHydrationWarning>
  ```
- [ ] Impl in `src/app/globals.css`: change the `--cairn-font-family` value (line 157-158) to lead with the Inter variable, keeping the full fallback chain:
  ```css
  --cairn-font-family:
    var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/font-inter-wired.test.ts`.
- [ ] **Manual-verify (post-build):** `source ~/.zshenv && pnpm build` succeeds (next/font runs at build) and a loaded page shows Inter as the computed `font-family` on `<body>`. The e2e a11y gate is the automated safety net for regressions.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(ui): ship Inter via next/font (display swap) as the branded sans (#1)"`

---

## U2 — Prose heading scale + base measure tokens (#1)

**Cause:** The editor surface is `prose prose-sm sm:prose-base` (`editor.tsx:103`) and relies entirely on Tailwind-typography heading defaults — there is **no** `prose-headings` / `--tw-prose` override in `globals.css` or `blocks.css`. The audit wants a tightened, tokenized heading scale + an explicit base measure.

**Fix:** Add two base tokens to the `@theme inline` block, then add a scoped `.ProseMirror` heading-scale CSS rule (sibling to the existing `.ProseMirror` rules in `globals.css`) that pins H1/H2/H3 size+weight+tracking. Scoping to `.ProseMirror` overrides the prose defaults without touching the generated `--tw-prose-*` chain or read-only public-page rendering.

**Files:**
- Modify: `src/app/globals.css`
- Create: `tests/components/prose-heading-scale.test.ts`

Steps:

- [ ] Write a failing source-text test `tests/components/prose-heading-scale.test.ts` (default `node` env — a token/rule *definition* has no DOM to compute against, so a file-content assertion is the practical check):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

  describe('prose typography tokens + scale (#1)', () => {
    it('defines the base measure tokens', () => {
      expect(css).toMatch(/--cairn-prose-base:\s*16px/);
      expect(css).toMatch(/--cairn-prose-leading:\s*1\.6/);
    });
    it('scopes a tightened heading scale to .ProseMirror', () => {
      expect(css).toMatch(/\.ProseMirror\s+h1[\s,{]/);
      expect(css).toMatch(/font-size:\s*1\.875rem/);
      expect(css).toMatch(/letter-spacing:\s*-0\.01em/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/prose-heading-scale.test.ts`.
- [ ] Impl in `src/app/globals.css`: inside the existing `@theme inline { … }` block, immediately before the `--radius-lg:` line, add the base tokens:
  ```css
  /* v0.9.11 #1 — editor base measure. The prose body reads at 16px/1.6 (Notion
     range). Tokenized here so the measure lives in one place; the .ProseMirror
     heading scale below pins the H-sizes. Font-only — no box-height change, so
     the a11y touch-target gate is unaffected. */
  --cairn-prose-base: 16px;
  --cairn-prose-leading: 1.6;
  ```
- [ ] Impl: add a scoped heading-scale block to `src/app/globals.css` (place it next to the existing `.ProseMirror` rules, e.g. just after the `.comment-anchor-flash` block ~line 151):
  ```css
  /* v0.9.11 #1 — tightened editor heading scale. Overrides Tailwind-typography
     defaults on the editing surface only (.ProseMirror), leaving --tw-prose-*
     and read-only public rendering alone. H1 1.875/600, H2 1.5/600, H3 1.25/600,
     all with -0.01em tracking for a denser, Notion-ish rhythm. Base body measure
     is the 16px/1.6 token above. */
  .ProseMirror {
    font-size: var(--cairn-prose-base);
    line-height: var(--cairn-prose-leading);
  }
  .ProseMirror h1 {
    font-size: 1.875rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .ProseMirror h2 {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .ProseMirror h3 {
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/prose-heading-scale.test.ts`.
- [ ] **Manual-verify:** in the editor, H1/H2/H3 render at the new scale with tighter tracking; body remains 16px/1.6. Public read-only pages (which do not carry `.ProseMirror`) are unchanged.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(editor): tokenized prose base measure + tightened heading scale (#1)"`

---

## U3 — Status-color token swaps (#3)

**Cause:** Raw Tailwind palette classes break single-accent discipline. `editor.tsx:87-88` uses `bg-amber-500` (connecting/disconnected) and `bg-emerald-500` (connected) for the collab status dot; `suggestion-toolbar.tsx:123,130` use `text-green-700 … dark:text-green-400` (Accept) and `text-red-700 … dark:text-red-400` (Reject). The semantic tokens already exist (`globals.css:29-32, 80-85` → `--color-success`/`--color-warning`/`--color-destructive`), so `bg-warning`/`bg-success`/`text-success`/`text-destructive` are valid utilities that adapt to light/dark automatically.

**Fix:** Swap the raw classes for tokens. `error` already uses `bg-destructive` (`editor.tsx:90`) — leave it. The token's light/dark values are pre-tuned in both `:root` and `.dark`, so the explicit `dark:` overrides on the suggestion buttons are dropped.

**Files:**
- Modify: `src/components/editor/editor.tsx`
- Modify: `src/components/editor/suggestion-toolbar.tsx`
- Create: `tests/components/status-color-tokens.test.ts`

Steps:

- [ ] Write a failing source-text test `tests/components/status-color-tokens.test.ts` (default `node` env):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const editor = readFileSync(join(process.cwd(), 'src/components/editor/editor.tsx'), 'utf8');
  const toolbar = readFileSync(
    join(process.cwd(), 'src/components/editor/suggestion-toolbar.tsx'),
    'utf8',
  );

  describe('status colors use semantic tokens (#3)', () => {
    it('editor status dot uses warning/success tokens, no raw palette', () => {
      expect(editor).not.toMatch(/bg-amber-500/);
      expect(editor).not.toMatch(/bg-emerald-500/);
      expect(editor).toMatch(/bg-warning/);
      expect(editor).toMatch(/bg-success/);
    });
    it('suggestion accept/reject use success/destructive tokens, no raw palette', () => {
      expect(toolbar).not.toMatch(/text-green-700/);
      expect(toolbar).not.toMatch(/text-red-700/);
      expect(toolbar).toMatch(/text-success/);
      expect(toolbar).toMatch(/text-destructive/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/status-color-tokens.test.ts`.
- [ ] Impl in `src/components/editor/editor.tsx` — the `STATUS_DOT` map (lines 86-91):
  ```ts
  const STATUS_DOT = {
    connecting: 'bg-warning',
    connected: 'bg-success',
    disconnected: 'bg-warning',
    error: 'bg-destructive',
  } as const;
  ```
- [ ] Impl in `src/components/editor/suggestion-toolbar.tsx` — the two buttons (lines 123, 130). Drop the now-redundant `dark:` overrides (the token already carries its dark value):
  ```tsx
  className="rounded px-2 py-1 text-success text-xs hover:bg-accent"
  ```
  ```tsx
  className="rounded px-2 py-1 text-destructive text-xs hover:bg-accent"
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/status-color-tokens.test.ts`.
- [ ] **Manual-verify:** status dot is amber/green/red via tokens in both themes; Accept/Reject read green/red and stay legible in dark mode.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "refactor(editor): swap raw status colors for semantic tokens (#3)"`

---

## U4 — Block-handle hover transition (#7)

**Cause:** The drag/insert handles in `drag-handle.tsx` are hover-tracked (correctly render only on hover) but the `+` button (line 101) and grip button (line 111) have `hover:bg-accent` with **no** `transition-colors`, so the tint snaps in/out.

**Fix:** Add `transition-colors duration-150` to both buttons' className. Height stays `h-6 w-6` (hover-only desktop mouse affordance — not a touch target; unchanged).

**Files:**
- Modify: `src/components/editor/drag-handle.tsx`
- Create: `tests/components/drag-handle-transition.test.ts`

Steps:

- [ ] Write a failing source-text test `tests/components/drag-handle-transition.test.ts` (default `node` env):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const src = readFileSync(
    join(process.cwd(), 'src/components/editor/drag-handle.tsx'),
    'utf8',
  );

  describe('drag-handle hover transition (#7)', () => {
    it('both handle buttons ease their hover tint', () => {
      const matches = src.match(/transition-colors duration-150/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/drag-handle-transition.test.ts`.
- [ ] Impl in `src/components/editor/drag-handle.tsx`: append `transition-colors duration-150` to the className on **both** the insert (`Plus`) button (~line 101) and the grip (`GripVertical`) button (~line 111). Each becomes:
  ```tsx
  className="text-muted-foreground hover:bg-accent flex h-6 w-6 items-center justify-center rounded transition-colors duration-150"
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/drag-handle-transition.test.ts`.
- [ ] **Manual-verify:** hovering a block, the `+`/grip tint eases in over ~150ms (and is clamped to instant under reduced-motion via the global media block).
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(editor): ease block-handle hover tint (#7)"`

---

## U5 — Page-cover bottom hairline (#8)

**Cause:** `cover-banner.tsx` renders the cover as a `cairn-cover h-[200px] w-full` band (all four kinds carry the `cairn-cover` class). The title sits *below* the banner (no overlay needed), but the band butts flush into the white page with no separation. The shared `.cairn-cover` rule (`globals.css:333-335`) currently only sets a filter transition.

**Fix:** Add `border-bottom: 1px solid hsl(var(--border))` to the existing `.cairn-cover` rule — a single token-driven hairline that adapts to light/dark and applies to every cover kind at once. (Doing it in CSS, not per-branch in the TSX, keeps it DRY across the four render paths.)

**Files:**
- Modify: `src/app/globals.css`
- Create: `tests/components/cover-hairline.test.ts`

Steps:

- [ ] Write a failing source-text test `tests/components/cover-hairline.test.ts` (default `node` env):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

  describe('cover bottom hairline (#8)', () => {
    it('.cairn-cover carries a token-driven bottom border', () => {
      const rule = css.match(/\.cairn-cover\s*\{[^}]*\}/s)?.[0] ?? '';
      expect(rule).toMatch(/border-bottom:\s*1px solid hsl\(var\(--border\)\)/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/cover-hairline.test.ts`.
- [ ] Impl in `src/app/globals.css`: add the hairline to the existing `.cairn-cover` rule (line ~333), keeping the filter transition:
  ```css
  .cairn-cover {
    transition: filter 150ms ease;
    /* v0.9.11 #8 — 1px token hairline so the cover band doesn't butt flush into
       the page. Adapts to light/dark via --border; applies to all cover kinds. */
    border-bottom: 1px solid hsl(var(--border));
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/cover-hairline.test.ts`.
- [ ] **Manual-verify:** a page with any cover (preset/color/unsplash/upload) shows a faint hairline under the band in both themes.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(pages): add token hairline under page cover (#8)"`

---

## U6 — Button press-scale + sheet timing (#10)

**Cause:** `buttonVariants` (`ui/button.tsx:8`) has `transition-colors` but no press feedback. The audit wants `active:scale-[0.98]` (reduced-motion-safe) and the sheet enter/exit pinned to the 150–300ms band. The reduced-motion guard already exists globally (`globals.css:275-285`).

**Fix:** In `ui/button.tsx`, extend the base string: change `transition-colors` → `transition-[color,background-color,border-color,transform]` (so the transform animates too), and add `active:scale-[0.98] motion-reduce:active:scale-100`. In `ui/sheet.tsx`, pin the content animation to `data-[state=open]:duration-200 data-[state=closed]:duration-150 ease-out` (enter 200ms, exit 150ms).

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/sheet.tsx`
- Create: `tests/components/button-press-scale.test.tsx`

Steps:

- [ ] Write a failing test `tests/components/button-press-scale.test.tsx` (**jsdom env** — renders the real component so the class lands through `cn`/cva, not just source text):
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { Button } from '@/components/ui/button';

  afterEach(cleanup);

  describe('button press-scale (#10)', () => {
    it('renders the reduced-motion-safe active scale', () => {
      render(<Button>Save</Button>);
      const cls = screen.getByRole('button', { name: 'Save' }).className;
      expect(cls).toMatch(/active:scale-\[0\.98\]/);
      expect(cls).toMatch(/motion-reduce:active:scale-100/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/button-press-scale.test.tsx`.
- [ ] Impl in `src/components/ui/button.tsx`: in the base `cva(...)` string (line 8), replace `transition-colors` with `transition-[color,background-color,border-color,transform]` and append the press classes. The base string becomes:
  ```ts
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,transform] active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ```
- [ ] Impl in `src/components/ui/sheet.tsx`: on the `SheetContent` animation className (the element carrying the `data-[state=open]:slide-in-from-*` / `data-[state=open]:animate-in` classes), add `ease-out data-[state=open]:duration-200 data-[state=closed]:duration-150`. (Locate the existing `data-[state=open]:animate-in` line and append these utilities to the same `className`.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/button-press-scale.test.tsx`.
- [ ] **Manual-verify:** clicking any `<Button>` gives a subtle press-shrink; sheets slide in ~200ms / out ~150ms; both are clamped to instant under OS reduced-motion. No button changes height (transform is layout-neutral).
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(ui): button press-scale + pinned sheet timings (#10)"`

---

## U7 — Empty-state icons for the four icon-less variants (#11)

**Cause:** `empty-state/variants.tsx` — `EmptyPageTree`, `EmptyFavorites`, `EmptyTrash`, `EmptyNotifications`, `EmptyFlashcardsDue` already pass an `icon`, but `EmptySearch` (line 16), `EmptyInbox` (line 77), `EmptyBacklinks` (line 83), and `EmptyRecents` (line 92) pass none. `EmptyState` already renders `icon` when present (`empty-state.tsx:35`).

**Fix:** Add a `lucide-react` icon (`aria-hidden="true"`, matching the existing variants' convention) to those four. No copy/i18n change (the variants already pull headline/guidance from `copy(...)`).

**Files:**
- Modify: `src/components/empty-state/variants.tsx`
- Create: `tests/components/empty-state-icons.test.tsx`

Steps:

- [ ] Write a failing test `tests/components/empty-state-icons.test.tsx` (**jsdom env** — renders each variant and asserts an SVG icon is present above the headline):
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import {
    EmptyBacklinks,
    EmptyInbox,
    EmptyRecents,
    EmptySearch,
  } from '@/components/empty-state/variants';

  // copy() reads flat-key i18n; stub to identity so the test is locale-agnostic.
  vi.mock('@/lib/copy/messages', () => ({ copy: (k: string) => k }));

  afterEach(cleanup);

  describe('icon-less empty states get icons (#11)', () => {
    it.each([
      ['search', <EmptySearch key="s" />],
      ['inbox', <EmptyInbox key="i" />],
      ['backlinks', <EmptyBacklinks key="b" />],
      ['recents', <EmptyRecents key="r" />],
    ])('%s renders an svg icon', (_name, el) => {
      const { container } = render(el);
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/empty-state-icons.test.tsx`.
- [ ] Impl in `src/components/empty-state/variants.tsx`: extend the lucide import (line 1) and add an `icon` prop to the four variants. Pick semantically apt icons:
  ```tsx
  import { BellOff, GraduationCap, Inbox, Link2, Search, Star, Trash2, Clock } from 'lucide-react';
  ```
  - `EmptySearch`: `icon={<Search aria-hidden="true" />}`
  - `EmptyInbox`: `icon={<Inbox aria-hidden="true" />}`
  - `EmptyBacklinks`: `icon={<Link2 aria-hidden="true" />}`
  - `EmptyRecents`: `icon={<Clock aria-hidden="true" />}`

  e.g. `EmptySearch` becomes:
  ```tsx
  export function EmptySearch() {
    return (
      <EmptyState
        icon={<Search aria-hidden="true" />}
        headline={copy('empty.search.headline')}
        guidance={copy('empty.search.guidance')}
      />
    );
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/empty-state-icons.test.tsx`.
- [ ] **Manual-verify:** the search/inbox/backlinks/recents empty states each show a muted icon above the headline, matching the other variants.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(empty-state): add icons to search/inbox/backlinks/recents (#11)"`

---

## U8 — Skeleton primitive + apply to three load surfaces (#16)

**Cause:** The app has spinners and bare text loaders but **no** skeleton. The audit wants `ui/skeleton.tsx` + skeleton rows on list-load surfaces. The three practical client surfaces are: notifications drawer (`drawer.tsx:181` `<p>Loading…</p>` while `isLoading && !data`), the search palette (`search-palette.tsx:291` `Searching…` while `loading`), and the cover-picker upload (`cover-picker.tsx` `animate-spin` spinner). *(The audit also names the "see also" panel, but that is an async **server** component — `see-also-panel.tsx` awaits before rendering and has no client loading state — so the cover-picker upload spinner is the apt third client surface.)*

**Fix:** Add `src/components/ui/skeleton.tsx` (`animate-pulse rounded-md bg-muted motion-reduce:animate-none`, plus passthrough className/props — the shadcn pattern). Replace the three text/spinner loaders with a small column of `<Skeleton>` rows. Skeletons are non-interactive `<div>`s — no touch-target impact.

**Files:**
- Create: `src/components/ui/skeleton.tsx`
- Create: `tests/components/skeleton.test.tsx`
- Modify: `src/components/notifications/drawer.tsx`
- Modify: `src/components/search-palette.tsx`
- Modify: `src/components/pages/cover-picker.tsx`

Steps:

- [ ] Write a failing test `tests/components/skeleton.test.tsx` (**jsdom env** — render-asserts the primitive):
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render } from '@testing-library/react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { Skeleton } from '@/components/ui/skeleton';

  afterEach(cleanup);

  describe('Skeleton primitive (#16)', () => {
    it('renders a reduced-motion-safe pulsing block and forwards className', () => {
      const { container } = render(<Skeleton className="h-4 w-32" />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.className).toMatch(/animate-pulse/);
      expect(el.className).toMatch(/motion-reduce:animate-none/);
      expect(el.className).toMatch(/bg-muted/);
      expect(el.className).toMatch(/h-4/);
      expect(el.className).toMatch(/w-32/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/skeleton.test.tsx`.
- [ ] Impl — create `src/components/ui/skeleton.tsx`:
  ```tsx
  import type * as React from 'react';
  import { cn } from '@/lib/utils';

  /**
   * v0.9.11 #16 — shadcn skeleton primitive. A non-interactive pulsing block for
   * >300ms loads. `animate-pulse` is disabled under prefers-reduced-motion via
   * `motion-reduce:animate-none` (and the global reduced-motion media block also
   * clamps it). Size/shape come from the passed className (e.g. `h-4 w-32`).
   */
  function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
      <div
        aria-hidden="true"
        className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
        {...props}
      />
    );
  }

  export { Skeleton };
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/skeleton.test.tsx`.
- [ ] Impl — `src/components/notifications/drawer.tsx`: import `Skeleton` and replace the `<p className="py-12 text-center text-muted-foreground">Loading…</p>` branch (line ~181) with a small column of skeleton rows:
  ```tsx
  <div className="space-y-3 py-2" aria-label="Loading notifications">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex items-start gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    ))}
  </div>
  ```
- [ ] Impl — `src/components/search-palette.tsx`: import `Skeleton` and replace the `{loading && <div …>Searching…</div>}` line (line ~291) with skeleton result rows:
  ```tsx
  {loading && (
    <div className="space-y-2 px-4 py-2" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  )}
  ```
- [ ] Impl — `src/components/pages/cover-picker.tsx`: import `Skeleton` and replace the upload-in-progress `animate-spin` spinner with a `<Skeleton className="h-[200px] w-full" />` placeholder for the pending cover band (keep the surrounding logic; swap only the spinner element). If the spinner is paired with text, keep an `aria-label` for the loading region.
- [ ] Re-run the primitive test to confirm nothing regressed: `source ~/.zshenv && pnpm vitest run tests/components/skeleton.test.tsx`.
- [ ] **Manual-verify:** notifications drawer (cold open), search palette (typing a query), and cover upload each show pulsing skeletons instead of bare "Loading…/Searching…"/spinner; pulse stops under reduced-motion.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(ui): add Skeleton primitive + apply to drawer/search/cover loads (#16)"`

---

## U9 — Verification gate

**Goal:** Prove the whole PATCH set is green and a11y-safe before HOLD-for-GO. No code changes in this task — run and confirm output.

Steps:

- [ ] Lint: `source ~/.zshenv && pnpm lint` — 0 errors (Biome may reorder imports / convert type-only imports in the touched files; accept its auto-fixes and re-commit if it writes any: `git add -A && git commit -m "style: biome autofix (Plan U)"`).
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck` — clean.
- [ ] Unit/component tests: `source ~/.zshenv && pnpm test` — all green (includes the seven new test files U1-U8). *(Testcontainers needs Docker/Colima up: `colima status` → `colima start` if down.)*
- [ ] Build (UI changes + `next/font` runs at build): `source ~/.zshenv && pnpm build` — succeeds.
- [ ] **A11y gate (safety net):** `source ~/.zshenv && pnpm test:a11y` — green. This is the load-bearing check that no interactive height dropped below 44px and no contrast regressed.
- [ ] Confirm the plan touched **only** the intended files (no stray edits): `source ~/.zshenv && git status --porcelain` and `git log --oneline patches/v0.9.11 -9`.
- [ ] **HOLD for GO.** Do **not** push or open/merge the PR — the controller/human integrates this into the single v0.9.11 PR.

---

## Deferred (REFACTOR — not v0.9.11)

These audit items need a structural component change, not a token/class edit, so they are **out of scope** for this plan (see `polish-audit.md` "Refactor list"):

- **#6 Shared `Badge` primitive** — create `src/components/ui/badge.tsx` (`outline`/`solid`/`status` variants) and migrate the 5 ad-hoc pills (`status-picker.tsx` ×2, `suggestion-toolbar.tsx`, `bibliography-toggle.tsx`, the `editor.tsx` status pill). Removes radius/size drift.
- **#18 Right-rail slide-in via Sheet** — route comments / outline / version-history / suggestions rails (currently `fixed inset-y-0 right-0` with no transition) through the shared `ui/sheet.tsx` so they slide in, instead of popping instantly.
- **#19 Settings single-sidebar** — `/settings` renders the workspace `<Sidebar>` *and* the `SettingsSidebar` (two left navs). Collapse the workspace sidebar under `/settings` (pathname conditional in `(app)/layout.tsx`, or a settings route group).

## Excluded — VERIFY-LIVE (post-redeploy checks, no code here)

Re-check after `ghcr.io/jonathanmcohen/cairn:v0.9.10` is deployed (cannot be confirmed statically):

- **#5 Top-toolbar consolidation** — whether the editor control strip + page action bar read as two competing toolbars. Only fold them (a REFACTOR) if live confirms the smell.
- **#20 Mobile-narrow responsive** — the `< md` auto-collapse + off-canvas drawer is correctly wired in code; confirm runtime smoothness / overlay z-index live (expected SHIP after redeploy).

## Excluded — SHIP

Audit rows #4 (spacing grid), #9 (approval banner), #12 (DB view header), #13 (selection toolbar), #14 (mention chips), and #2 (sidebar density — already covered by `plan-c-sidebar-density.md`) are already polished; no work.
