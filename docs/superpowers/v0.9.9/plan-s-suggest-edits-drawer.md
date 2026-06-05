# v0.9.9 — Plan S — Suggest Edits Drawer

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal**
Close the two Suggest-edits-surface findings from the v0.9.8 live audit:
- **S1 (#232 / #53)** — Each suggestion card in the suggestions drawer shows a real *inline diff preview*: the suggestion's deleted text rendered as strikethrough, followed by its inserted text rendered as an additive highlight. Today `suggestions-drawer.tsx` shows only the author name + Accept/Reject/View buttons, so a reviewer cannot tell *what* a suggestion changes without scrolling to it in the document.
- **S2 (#233 / #54)** — The whole "Suggest edits" / "Suggesting" chip (and the open-count badge) is the click target, not a sub-region of it. The current toggle button already spans the label, but the open-count *badge* in `suggestion-toolbar.tsx` is a separate control and the chip group reads as two disjoint hit areas; this item makes the toggle a single cohesive clickable chip and verifies the entire chip surface (icon + label) routes to `onToggle`.

**Architecture**
The suggestion data model is unchanged. Suggestion authorship and `open|accepted|rejected` status live in the `suggestions` table (`src/lib/suggestions/index-sync.ts`); the actual *content* of a suggestion lives in the live Yjs/ProseMirror doc as `suggestionInsert` / `suggestionDelete` marks (and `suggestionBlock` nodes) keyed by `suggestionId` (`src/lib/suggestions/transform.ts`). The diff text is therefore derivable **client-side** by walking the editor's current JSON for the marks carrying a given `suggestionId` — no new API field, no migration. The editor (`src/components/editor/editor.tsx`) already holds the live `editor` instance and the `openSuggestions` row list; it will compute a `DiffPreview` per suggestion id from `editor.getJSON()` and pass it through to the drawer. We add one pure, unit-testable helper (`src/lib/suggestions/diff-preview.ts`) that takes ProseMirror JSON + a `suggestionId` and returns `{ deleted: string; inserted: string }`. The drawer renders that as strikethrough → highlight. No new tables, no new routes, no migration in this plan.

**Tech Stack**
Next.js 16 App Router · React 19 · TypeScript 6 strict · TipTap 3 (`@tiptap/pm/model` for the JSON walk) · Tailwind v4 + shadcn/ui · radix-ui Dialog/Tooltip · i18n en/es/ar via `useT()` · Biome v2 (0 errors) · Vitest 4 + jsdom (component) / Testcontainers (none needed here). All CI on GitHub-hosted runners only.

---

## S1 — Inline diff preview in each suggestion card (#232 / #53)

A reviewer opening the suggestions drawer must see, per card, the original text struck through followed by the suggested text highlighted, so they can accept/reject without leaving the drawer. The diff is computed from the live doc JSON by collecting `suggestionDelete`-marked text (the original) and `suggestionInsert`-marked text (the suggested replacement) for each `suggestionId`, in document order.

**Files:**
- Create `src/lib/suggestions/diff-preview.ts` — pure `computeDiffPreview(doc, suggestionId)` helper.
- Create `tests/suggestions/diff-preview.test.ts` — unit tests for the helper.
- Modify `src/components/editor/suggestions-drawer.tsx` — extend `OpenSuggestion` with an optional `diff` field; render strikethrough/highlight.
- Modify `tests/components/editor/suggestions-drawer.test.tsx` — assert the diff renders.
- Modify `src/components/editor/editor.tsx` — compute the diff per row from `editor.getJSON()` when building `openSuggestions` and when resolving.
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` — new diff a11y/label keys.
- Create `tests/i18n/plan-s-keys.test.ts` — assert the new keys exist in all three locales.

TDD steps:

- [ ] **Write failing test for the pure diff helper.** Create `tests/suggestions/diff-preview.test.ts`. The helper walks a ProseMirror doc JSON (same shape as `Json` in `transform.ts`) and returns the concatenated `suggestionDelete` text as `deleted` and the concatenated `suggestionInsert` text as `inserted`, both in document order, scoped to one `suggestionId`. Cover: insert-only, delete-only, mixed replace, unknown id → empty strings, and multi-text-node concatenation across paragraphs.
  ```ts
  import { describe, expect, it } from 'vitest';
  import type { Json } from '@/lib/suggestions/transform';
  import { computeDiffPreview } from '@/lib/suggestions/diff-preview';

  const mark = (type: string, suggestionId: string) => ({ type, attrs: { suggestionId } });
  const text = (t: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): Json =>
    ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
  const para = (...content: Json[]): Json => ({ type: 'paragraph', content });
  const doc = (...content: Json[]): Json => ({ type: 'doc', content });

  describe('computeDiffPreview', () => {
    it('returns inserted text for an insert-only suggestion', () => {
      const d = doc(para(text('keep '), text('added', [mark('suggestionInsert', 's1')])));
      expect(computeDiffPreview(d, 's1')).toEqual({ deleted: '', inserted: 'added' });
    });

    it('returns deleted text for a delete-only suggestion', () => {
      const d = doc(para(text('gone', [mark('suggestionDelete', 's1')]), text(' stays')));
      expect(computeDiffPreview(d, 's1')).toEqual({ deleted: 'gone', inserted: '' });
    });

    it('returns both halves for a replace and ignores other ids', () => {
      const d = doc(
        para(
          text('old', [mark('suggestionDelete', 's1')]),
          text('new', [mark('suggestionInsert', 's1')]),
          text('elsewhere', [mark('suggestionInsert', 's2')]),
        ),
      );
      expect(computeDiffPreview(d, 's1')).toEqual({ deleted: 'old', inserted: 'new' });
    });

    it('concatenates marked text across multiple nodes in document order', () => {
      const d = doc(
        para(text('a', [mark('suggestionInsert', 's1')])),
        para(text('b', [mark('suggestionInsert', 's1')])),
      );
      expect(computeDiffPreview(d, 's1')).toEqual({ deleted: '', inserted: 'ab' });
    });

    it('returns empty strings for an unknown id', () => {
      const d = doc(para(text('x', [mark('suggestionInsert', 's1')])));
      expect(computeDiffPreview(d, 'nope')).toEqual({ deleted: '', inserted: '' });
    });
  });
  ```
- [ ] **Run to fail.** `source ~/.zshenv && pnpm vitest run tests/suggestions/diff-preview.test.ts` → fails (module does not exist).
- [ ] **Minimal implementation of the helper.** Create `src/lib/suggestions/diff-preview.ts`. Walk the JSON tree directly (no schema parse needed — we only read text + mark types, which keeps it dependency-free and server-safe). Concatenate in pre-order traversal so document order is preserved.
  ```ts
  import type { Json } from './transform';

  const INSERT = 'suggestionInsert';
  const DELETE = 'suggestionDelete';

  /** The strikethrough (`deleted`) + highlight (`inserted`) halves of one suggestion. */
  export type DiffPreview = { deleted: string; inserted: string };

  /**
   * Collect the deleted/inserted text of a single suggestion from a ProseMirror
   * doc JSON, in document (pre-order) order. Pure — no schema parse, no Yjs.
   * `suggestionDelete`-marked text is the original (struck through); `suggestionInsert`
   * is the proposed replacement (highlighted). Unknown ids return empty strings.
   */
  export function computeDiffPreview(doc: Json, suggestionId: string): DiffPreview {
    let deleted = '';
    let inserted = '';
    const visit = (node: Json): void => {
      if (typeof node.text === 'string' && Array.isArray(node.marks)) {
        for (const m of node.marks) {
          if (m.attrs?.suggestionId !== suggestionId) continue;
          if (m.type === DELETE) deleted += node.text;
          else if (m.type === INSERT) inserted += node.text;
        }
      }
      if (Array.isArray(node.content)) for (const child of node.content) visit(child);
    };
    visit(doc);
    return { deleted, inserted };
  }
  ```
- [ ] **Run to pass.** `source ~/.zshenv && pnpm vitest run tests/suggestions/diff-preview.test.ts` → green.
- [ ] **Commit.** `feat(suggestions): add pure computeDiffPreview helper for drawer diff (#232)`
- [ ] **Write failing i18n key test.** Create `tests/i18n/plan-s-keys.test.ts` asserting the two new keys exist in en/es/ar. (S2 adds none, so this file covers Plan S in full.)
  ```ts
  import { describe, expect, it } from 'vitest';
  import arMessages from '../../messages/ar.json' with { type: 'json' };
  import enMessages from '../../messages/en.json' with { type: 'json' };
  import esMessages from '../../messages/es.json' with { type: 'json' };

  const NEW_KEYS = [
    'pageActions.suggest.diffDeletedLabel',
    'pageActions.suggest.diffInsertedLabel',
  ] as const;
  const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
    string,
    Record<string, string>
  >;

  describe('Plan S i18n keys (#232/#233)', () => {
    for (const [locale, messages] of Object.entries(catalogs)) {
      for (const key of NEW_KEYS) {
        it(`${locale} has a non-empty value for ${key}`, () => {
          expect(typeof messages[key]).toBe('string');
          expect((messages[key] ?? '').length).toBeGreaterThan(0);
        });
      }
    }
  });
  ```
- [ ] **Run to fail.** `source ~/.zshenv && pnpm vitest run tests/i18n/plan-s-keys.test.ts` → fails (keys absent).
- [ ] **Add the i18n keys (flat dotted keys, alongside the existing `pageActions.suggest.*` entries).** In `messages/en.json`:
  ```json
  "pageActions.suggest.diffDeletedLabel": "Removed text",
  "pageActions.suggest.diffInsertedLabel": "Added text"
  ```
  In `messages/es.json`:
  ```json
  "pageActions.suggest.diffDeletedLabel": "Texto eliminado",
  "pageActions.suggest.diffInsertedLabel": "Texto añadido"
  ```
  In `messages/ar.json`:
  ```json
  "pageActions.suggest.diffDeletedLabel": "نص محذوف",
  "pageActions.suggest.diffInsertedLabel": "نص مضاف"
  ```
- [ ] **Run to pass.** `source ~/.zshenv && pnpm vitest run tests/i18n/plan-s-keys.test.ts` → green.
- [ ] **Commit.** `feat(i18n): add suggestion diff-preview labels en/es/ar (#232)`
- [ ] **Write failing drawer-render test.** Extend `tests/components/editor/suggestions-drawer.test.tsx`. Add a row with a `diff` and assert the deleted half renders struck through (a `<del>` element) and the inserted half renders as an `<ins>` element, both with the marked text.
  ```tsx
  it('renders an inline diff preview when a row carries one (#232)', () => {
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[
            { id: 's1', authorName: 'Ada', diff: { deleted: 'old text', inserted: 'new text' } },
          ]}
          onAccept={() => {}}
          onReject={() => {}}
          onView={() => {}}
        />,
      ),
    );
    const del = screen.getByText('old text');
    expect(del.tagName).toBe('DEL');
    const ins = screen.getByText('new text');
    expect(ins.tagName).toBe('INS');
  });

  it('omits the diff block when a row has no diff', () => {
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[{ id: 's1', authorName: 'Ada' }]}
          onAccept={() => {}}
          onReject={() => {}}
          onView={() => {}}
        />,
      ),
    );
    expect(screen.queryByText(enMessages['pageActions.suggest.diffDeletedLabel'])).toBeNull();
  });
  ```
- [ ] **Run to fail.** `source ~/.zshenv && pnpm vitest run tests/components/editor/suggestions-drawer.test.tsx` → fails (`diff` not on type; no `<del>`/`<ins>` rendered).
- [ ] **Implement the diff render in the drawer.** Modify `src/components/editor/suggestions-drawer.tsx`. Extend the `OpenSuggestion` type and render the diff between the author line and the action buttons. Empty halves are skipped so a pure-insert or pure-delete renders only the relevant span. The `<del>`/`<ins>` carry `title`/`aria-label` from the new i18n keys.
  ```tsx
  import { X } from 'lucide-react';
  import { Dialog } from 'radix-ui';
  import { useT } from '@/lib/i18n/provider';

  /** A single open suggestion row, projected for the drawer list. */
  export type OpenSuggestion = {
    id: string;
    /** Resolved author display name; falls back to a generic label upstream. */
    authorName: string;
    /**
     * #232 — inline diff halves for this suggestion, derived from the live doc by
     * computeDiffPreview(). Optional: a brand-new (empty) suggestion has neither half.
     */
    diff?: { deleted: string; inserted: string };
  };
  ```
  Inside the `<li>`, immediately after the author `<p>` and before the `<div className="mt-2 flex …">` action row, insert:
  ```tsx
  {s.diff && (s.diff.deleted || s.diff.inserted) ? (
    <p className="mt-2 break-words text-sm leading-relaxed">
      {s.diff.deleted ? (
        <del
          aria-label={t('pageActions.suggest.diffDeletedLabel')}
          title={t('pageActions.suggest.diffDeletedLabel')}
          className="rounded-sm bg-red-500/10 px-0.5 text-red-700 line-through decoration-red-500/70 dark:text-red-300"
        >
          {s.diff.deleted}
        </del>
      ) : null}
      {s.diff.deleted && s.diff.inserted ? ' ' : null}
      {s.diff.inserted ? (
        <ins
          aria-label={t('pageActions.suggest.diffInsertedLabel')}
          title={t('pageActions.suggest.diffInsertedLabel')}
          className="rounded-sm bg-green-500/10 px-0.5 text-green-700 no-underline dark:text-green-300"
        >
          {s.diff.inserted}
        </ins>
      ) : null}
    </p>
  ) : null}
  ```
- [ ] **Run to pass.** `source ~/.zshenv && pnpm vitest run tests/components/editor/suggestions-drawer.test.tsx` → green (existing accept/reject/empty cases still pass).
- [ ] **Commit.** `feat(editor): render inline diff preview in suggestion cards (#232)`
- [ ] **Wire the diff in the editor.** Modify `src/components/editor/editor.tsx`. Import the helper and compute a `diff` per row from the live doc when populating `openSuggestions`. Because the suggestion list comes from `GET /api/pages/[pageId]/suggestions` (DB-backed ids + author) while the diff text lives in the doc, attach the diff in a small projection right where rows are built, using the live `editorRef`/`editor` JSON.

  Add the import next to the existing suggestions import (Biome will sort it):
  ```ts
  import { computeDiffPreview } from '@/lib/suggestions/diff-preview';
  ```
  In the open-suggestion-count effect (currently lines ~417–435), replace the `setOpenSuggestions(...)` mapping so each row carries its diff. The effect already depends on `[effectiveEditable, pageId]`; the editor JSON is read at fetch time via `editorRef.current`:
  ```ts
      setOpenSuggestions(
        data.suggestions.map((s) => {
          const json = editorRef.current?.getJSON() as Json | undefined;
          return {
            id: s.id,
            authorName: s.authorName ?? 'Anonymous',
            diff: json ? computeDiffPreview(json, s.id) : undefined,
          };
        }),
      );
  ```
  (`Json` is already imported from `@/lib/suggestions/transform` on line 14.) Leave the `resolve()` optimistic `setOpenSuggestions((rows) => rows.filter(...))` as-is — resolved rows are removed, not re-diffed.
- [ ] **Run typecheck + the drawer/helper tests together.** `source ~/.zshenv && pnpm typecheck && pnpm vitest run tests/suggestions/diff-preview.test.ts tests/components/editor/suggestions-drawer.test.tsx` → green.
- [ ] **Commit.** `feat(editor): pass computed suggestion diffs into the drawer (#232)`

---

## S2 — Whole "Suggest edits" chip clickable, not just the badge (#233 / #54)

The toggle in `suggestion-toolbar.tsx` should read and behave as one cohesive chip: clicking anywhere on the chip surface (the icon and the label, padding included) toggles suggestion mode. We add a leading icon so the chip is unambiguously a single control, give it a consistent rounded-chip shape in both states, and add a test that asserts a click on a child node inside the chip (the icon) still fires `onToggle` — proving the *whole* chip is the hit target, not just the text.

**Files:**
- Modify `src/components/editor/suggestion-toolbar.tsx` — make the toggle a single icon+label chip; add `data-testid` for the chip; add `aria-label`.
- Modify `tests/components/editor/suggestion-toolbar.test.tsx` — assert clicking the chip (and its inner icon) fires `onToggle` and the chip is one element.
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` — add chip `aria-label` keys for both states.
- Modify `tests/i18n/plan-s-keys.test.ts` — extend `NEW_KEYS` with the two chip-label keys.

TDD steps:

- [ ] **Extend the i18n key test (run-to-fail).** Add the two chip-label keys to `NEW_KEYS` in `tests/i18n/plan-s-keys.test.ts`:
  ```ts
  const NEW_KEYS = [
    'pageActions.suggest.diffDeletedLabel',
    'pageActions.suggest.diffInsertedLabel',
    'pageActions.suggest.toggleSuggest',
    'pageActions.suggest.toggleSuggesting',
  ] as const;
  ```
- [ ] **Run to fail.** `source ~/.zshenv && pnpm vitest run tests/i18n/plan-s-keys.test.ts` → fails on the two new keys.
- [ ] **Add the chip-label i18n keys.** In `messages/en.json`:
  ```json
  "pageActions.suggest.toggleSuggest": "Suggest edits",
  "pageActions.suggest.toggleSuggesting": "Suggesting — click to stop"
  ```
  In `messages/es.json`:
  ```json
  "pageActions.suggest.toggleSuggest": "Sugerir ediciones",
  "pageActions.suggest.toggleSuggesting": "Sugiriendo — haz clic para detener"
  ```
  In `messages/ar.json`:
  ```json
  "pageActions.suggest.toggleSuggest": "اقتراح تعديلات",
  "pageActions.suggest.toggleSuggesting": "جارٍ الاقتراح — انقر للإيقاف"
  ```
- [ ] **Run to pass.** `source ~/.zshenv && pnpm vitest run tests/i18n/plan-s-keys.test.ts` → green.
- [ ] **Commit.** `feat(i18n): add suggest-toggle chip aria-labels en/es/ar (#233)`
- [ ] **Write failing toolbar test.** Modify `tests/components/editor/suggestion-toolbar.test.tsx`. Render with `active={false}`, find the chip by its `data-testid="suggest-toggle-chip"`, click the chip itself AND click its inner icon (`chip.querySelector('svg')`), and assert `onToggle` fired for both — proving the icon is inside the same clickable element. Also assert the chip exposes the localized `aria-label`.
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, fireEvent, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { SuggestionToolbar } from '@/components/editor/suggestion-toolbar';
  import { I18nProvider } from '@/lib/i18n/provider';
  import enMessages from '../../../messages/en.json';

  afterEach(cleanup);
  const wrap = (ui: React.ReactNode) => (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
  const baseProps = {
    editor: null,
    openCount: 0,
    onMarkInsert: () => {},
    onMarkDelete: () => {},
    resolvable: null,
    onAccept: () => {},
    onReject: () => {},
    onOpenDrawer: () => {},
  };

  describe('<SuggestionToolbar> chip is one clickable target (#233)', () => {
    it('fires onToggle when the chip or its inner icon is clicked', () => {
      const onToggle = vi.fn();
      render(wrap(<SuggestionToolbar {...baseProps} active={false} onToggle={onToggle} />));
      const chip = screen.getByTestId('suggest-toggle-chip');
      expect(chip.getAttribute('aria-label')).toBe(enMessages['pageActions.suggest.toggleSuggest']);
      fireEvent.click(chip);
      const icon = chip.querySelector('svg');
      expect(icon).not.toBeNull();
      fireEvent.click(icon as SVGElement);
      expect(onToggle).toHaveBeenCalledTimes(2);
    });

    it('exposes the active aria-label while suggesting', () => {
      render(wrap(<SuggestionToolbar {...baseProps} active onToggle={() => {}} />));
      const chip = screen.getByTestId('suggest-toggle-chip');
      expect(chip.getAttribute('aria-label')).toBe(
        enMessages['pageActions.suggest.toggleSuggesting'],
      );
      expect(chip.getAttribute('aria-pressed')).toBe('true');
    });
  });
  ```
- [ ] **Run to fail.** `source ~/.zshenv && pnpm vitest run tests/components/editor/suggestion-toolbar.test.tsx` → fails (no `data-testid`, no icon, no localized `aria-label`).
- [ ] **Implement the cohesive chip.** Modify `src/components/editor/suggestion-toolbar.tsx`. Replace the bare toggle `<button>` (current lines ~37–48) with an icon+label chip that is a single `<button>` element so every pixel routes to `onToggle`. Add `PencilLine` to the lucide import. The icon is `aria-hidden`, the button carries the state-dependent `aria-label`, and `data-testid` anchors the test.
  ```tsx
  import { Minus, PencilLine, Plus } from 'lucide-react';
  ```
  ```tsx
        <button
          type="button"
          data-testid="suggest-toggle-chip"
          aria-pressed={active}
          aria-label={t(
            active ? 'pageActions.suggest.toggleSuggesting' : 'pageActions.suggest.toggleSuggest',
          )}
          onClick={onToggle}
          className={
            active
              ? 'inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-primary-foreground text-xs font-medium'
              : 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground text-xs font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring'
          }
        >
          <PencilLine aria-hidden="true" className="h-3.5 w-3.5" />
          {active ? t('pageActions.suggest.toggleSuggesting') : t('pageActions.suggest.toggleSuggest')}
        </button>
  ```
  Note: the visible label now uses the same localized strings (replacing the hardcoded English `'Suggesting'` / `'Suggest edits'`), which also removes two raw strings from the component.
- [ ] **Run to pass.** `source ~/.zshenv && pnpm vitest run tests/components/editor/suggestion-toolbar.test.tsx` → green.
- [ ] **Commit.** `feat(editor): make whole suggest-edits chip a single clickable target (#233)`

---

## Plan S — group gate (HOLD for GO)

Run the full gate on a clean tree against `patches/v0.9.9`. Every command must pass with the stated result before the PR opens.

- [ ] **Lint — 0 errors.** `source ~/.zshenv && pnpm lint` → 0 errors, 0 warnings. (Biome will reorder the new imports in `editor.tsx`/`suggestion-toolbar.tsx`; accept its `--write` output.)
- [ ] **Typecheck.** `source ~/.zshenv && pnpm typecheck` → clean (`OpenSuggestion.diff`, `DiffPreview`, `computeDiffPreview`, chip props all type-check).
- [ ] **i18n — no new untranslated keys.** `source ~/.zshenv && pnpm vitest run tests/i18n/plan-s-keys.test.ts` → green, AND run the repo i18n audit so en/es/ar stay in parity: `source ~/.zshenv && pnpm vitest run tests/scripts/i18n-audit.test.ts` → green (no missing-key drift introduced by the four new keys).
- [ ] **Full test suite.** `source ~/.zshenv && pnpm vitest run` → all suites green (Testcontainers Postgres required; `colima start` if the daemon is down). No `.only`, no skips added.
- [ ] **Build.** `source ~/.zshenv && pnpm build` → succeeds (`next build` + entrypoint `tsc`).
- [ ] **e2e UI-acceptance gate (route-reachability + per-feature deployed-image check), GitHub-hosted runner only.**
  - Route reachability: an editor-role page (`/pages/<id>`) renders the editor surface with the suggest-edits chip present in the top control strip (the `data-testid="suggest-toggle-chip"` element is reachable and clickable).
  - Per-feature deployed-image checks:
    - **S2:** open an editor page → assert the suggest-edits chip toggles into the "Suggesting" state on click anywhere within the chip (icon or label), and `aria-pressed` flips to `true`.
    - **S1:** with suggestion mode on, mark a selection as inserted and/or deleted, then open the suggestions drawer via the open-count badge → assert the card shows a `<del>` (struck-through original) and/or `<ins>` (highlighted addition) reflecting the marked text; accept the suggestion and assert the card disappears.
- [ ] **Open the single PR onto `patches/v0.9.9` and HOLD for user GO before merge.** Do not push or merge from a subagent; the controller/human pushes. PR title: `feat(editor): suggest-edits drawer diff preview + cohesive toggle chip (#232 #233)`.
