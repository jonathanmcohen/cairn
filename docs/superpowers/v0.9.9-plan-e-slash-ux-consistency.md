# v0.9.9 Plan E — Slash Command UX Consistency

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Make the input-collecting slash commands (`/equation`, `/citation`, `/footnote`) share the same themed-modal pattern already used by `/flashcard` — fields collected up front in a radix dialog, with `/equation` gaining a LaTeX field + live KaTeX preview and `/citation` gaining DOI auto-fetch via the existing `/api/citations/lookup` endpoint — so the editor's slash ergonomics stop mixing "drop an empty node and click it" (current `/equation`) with "fill a modal" (current `/citation`, `/footnote`, `/flashcard`). Separately, fix the comment composer so that text typed *after* an `@`-mention pick is preserved through the write + serialization path into the persisted comment body (#73/#253).

**Architecture:** All slash input dialogs go through the framework-free pub/sub `editor-dialog-bus.ts` → the single `<EditorDialogs>` React host (`src/components/editor/editor-dialogs.tsx`). Today the host renders a generic multi-field form for `footnote`/`citation`/`flashcard` and a bespoke `CitationAddDialog` for `citationLookup`. Plan E (a) adds a new `equation` dialog kind with a live-preview body (custom render branch, like `citationLookup`), (b) folds DOI auto-fetch into the generic `citation` form so the manual `/citation` modal can resolve a DOI to author/title/year inline, and (c) routes the empty-node `/equation` slash item through the new modal instead of inserting a blank `math` node. The mention/comment fix is in the serialization read path: the composer reports `editor.getText()` on `onUpdate`; we will confirm the exact loss point (composer text serializer vs. `createComment` body trim vs. POST `z.string()` parse) with a failing test first, then apply the minimal fix in `src/lib/comments/create.ts` and/or the mention node's `renderText`/composer serializer per the bisection result.

**Tech Stack:** Next.js 16 App Router, React 19, TS6 (strict), TipTap 3 (`@tiptap/react`, `@tiptap/extension-mention`, `@tiptap/suggestion`), KaTeX 0.17 (`renderMath` in `src/lib/editor/math-render.ts`), Drizzle + Postgres (no schema change in this plan), Biome v2, Vitest 4 + Testcontainers (real Postgres for comment lib/route tests), Tailwind v4 + shadcn/ui (`Dialog`, `Input`, `Label`, `Button`), i18n en/es/ar via `useT()`. Depends on **Plan A A3** (slash parser range/restore-on-cancel fix in `slash-extension.ts`) landing first — E1's dialog flows assume the parser awaits the dialog promise before `deleteRange`, which A3 delivers.

> **Dependency note:** Do not start E1 until Plan A A3 is merged to `patches/v0.9.9`. A3 changes `SlashCommand.suggestion.command` to await async/early-return resolution before deleting the trigger range; E1 relies on that so a cancelled equation/citation modal does not leave a stray `/` or delete surrounding text.

> **Migrations:** none in this plan. (Latest applied is 0061; v0.9.9 migrations start at 0062 and are owned by other plans per the scope doc.)

---

## E1a — `/equation` LaTeX modal with live KaTeX preview (#246, #274)

Replace the current `/equation` behavior (insert an empty `math` node, then require a click to reveal the `<textarea>`) with an up-front modal: a LaTeX text field plus a live-rendered KaTeX preview, matching the modal-first pattern of `/flashcard`. The modal resolves `{ latex, display }`; only then do we lazy-load the `math` extension and insert a populated node.

**Files:**
- Modify `src/components/editor/editor-dialog-bus.ts` (add `equation` kind to `EditorDialogSpec`, add `EditorDialogEquationResult`, extend `EditorDialogResult`, update `asFormResult`)
- Create `src/components/editor/blocks/equation-add-dialog.tsx` (self-contained dialog: LaTeX `<textarea>` + display toggle + live KaTeX preview)
- Modify `src/components/editor/editor-dialogs.tsx` (early-return render branch for `equation`, like `citationLookup`)
- Modify `src/components/editor/slash-extension.ts` (the `Equation` slash item `command` opens the dialog, then `setMath` with the collected latex)
- Create `tests/components/editor/equation-add-dialog.test.tsx`
- Create `tests/components/editor/equation-slash.test.ts`
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

TDD steps:

- [ ] Write failing test `tests/components/editor/equation-add-dialog.test.tsx`: render `<EquationAddDialog open onClose onInsert />`, type `\frac{1}{2}` into the field with label "LaTeX", assert the preview region (`data-testid="equation-preview"`) contains KaTeX output (mock `@/lib/editor/math-render`'s `renderMath` to return `<span class="katex">RENDERED:\frac{1}{2}</span>` and assert the rendered string appears), toggle the "Display (block)" checkbox, click "Insert", assert `onInsert` called with `{ latex: '\\frac{1}{2}', display: true }`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/editor/equation-add-dialog.test.tsx` (module not found).
- [ ] Implement `src/components/editor/blocks/equation-add-dialog.tsx`. Mirror `citation-add-dialog.tsx`'s self-contained shell (fixed backdrop + `role="dialog"` + `aria-modal` + Esc-to-close + `useFocusTrap`). Body:
  ```tsx
  'use client';

  import { useEffect, useId, useMemo, useState } from 'react';
  import { Button } from '@/components/ui/button';
  import { Label } from '@/components/ui/label';
  import { useFocusTrap } from '@/lib/a11y/focus-trap';
  import { renderMath } from '@/lib/editor/math-render';
  import { useT } from '@/lib/i18n/provider';

  export type EquationAddDialogProps = {
    open: boolean;
    onClose: () => void;
    onInsert: (latex: string, display: boolean) => void;
  };

  export function EquationAddDialog({ open, onClose, onInsert }: EquationAddDialogProps) {
    const t = useT();
    const [latex, setLatex] = useState('');
    const [display, setDisplay] = useState(true);
    const inputId = useId();
    const titleId = useId();
    const dialogRef = useFocusTrap<HTMLDivElement>(open);
    const preview = useMemo(() => renderMath(latex, display), [latex, display]);

    useEffect(() => {
      if (!open) return;
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6"
        >
          <h2 id={titleId} className="font-medium text-lg">
            {t('editor.equation.title')}
          </h2>
          <div className="space-y-2">
            <Label htmlFor={inputId}>{t('editor.equation.latexLabel')}</Label>
            <textarea
              id={inputId}
              // biome-ignore lint/a11y/noAutofocus: focus trap returns this field first; explicit autofocus avoids a flash.
              autoFocus
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              placeholder={t('editor.equation.latexPlaceholder')}
              className="w-full rounded border bg-background p-2 font-mono text-xs"
              rows={3}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
            {t('editor.equation.displayLabel')}
          </label>
          <div
            aria-live="polite"
            className="min-h-12 rounded border bg-muted/40 p-3 text-center text-sm"
            data-testid="equation-preview"
            // KaTeX output is sanitized HTML from the local trusted renderer (no remote input).
            // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX-rendered math, local-only.
            dangerouslySetInnerHTML={{ __html: latex.trim() ? preview : '' }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!latex.trim()}
              onClick={() => {
                if (!latex.trim()) return;
                onInsert(latex, display);
                setLatex('');
                onClose();
              }}
            >
              {t('common.add')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/editor/equation-add-dialog.test.tsx`.
- [ ] Add the three new strings to each message file. `messages/en.json`:
  ```json
  "editor.equation.title": "Insert equation",
  "editor.equation.latexLabel": "LaTeX",
  "editor.equation.latexPlaceholder": "e.g. \\frac{a}{b}",
  "editor.equation.displayLabel": "Display (block)"
  ```
  `messages/es.json`:
  ```json
  "editor.equation.title": "Insertar ecuación",
  "editor.equation.latexLabel": "LaTeX",
  "editor.equation.latexPlaceholder": "p. ej. \\frac{a}{b}",
  "editor.equation.displayLabel": "En bloque"
  ```
  `messages/ar.json`:
  ```json
  "editor.equation.title": "إدراج معادلة",
  "editor.equation.latexLabel": "LaTeX",
  "editor.equation.latexPlaceholder": "مثال \\frac{a}{b}",
  "editor.equation.displayLabel": "عرض ككتلة"
  ```
- [ ] Run i18n parity check: `source ~/.zshenv && pnpm lint` (Biome i18n rule flags missing keys across locales — expect 0 new findings).
- [ ] Commit: `feat(editor): add live-preview LaTeX equation dialog component (#246)`
- [ ] Write failing test `tests/components/editor/equation-slash.test.ts` for the bus wiring: add `equation` to `EditorDialogSpec` is required for this to type-check. Test: spy on `openEditorDialog`, find the `Equation` `SlashItem` in `SLASH_ITEMS`, call its `command(editorStub)`, assert `openEditorDialog` was called with `{ kind: 'equation', title: ... }`; resolve the spy with `{ kind: 'equation', latex: 'x^2', display: true }` and assert `editorStub.chain().focus().setMath` is reached with `{ latex: 'x^2', display: true }` (use the same chained-stub pattern as `tests/components/editor/citation-slash.test.ts`).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/editor/equation-slash.test.ts`.
- [ ] Implement bus types in `editor-dialog-bus.ts`:
  - Add to `EditorDialogSpec` union: `| { kind: 'equation'; title: string; description?: string }`.
  - Add result type: `export type EditorDialogEquationResult = { kind: 'equation'; latex: string; display: boolean };`
  - Extend `EditorDialogResult`: `... | EditorDialogEquationResult | null`.
  - Extend `asFormResult` guard: also return `null` when `'kind' in result && result.kind === 'equation'` (so non-form callers stay narrowed).
- [ ] Implement the slash item in `slash-extension.ts`. Replace the existing `Equation` item `command` body:
  ```ts
  command: (editor) => {
    void openEditorDialog({ kind: 'equation', title: 'Insert equation' }).then((raw) => {
      if (!raw || !('kind' in raw) || raw.kind !== 'equation') return;
      const { latex, display } = raw;
      if (!latex.trim()) return;
      void ensureLazyExtension(editor, 'math').then(() => {
        if (editor.isDestroyed) return;
        editor.chain().focus().setMath({ latex, display }).run();
      });
    });
  },
  ```
  (Keep its `title`/`description`/`category: 'advanced'`/`icon: Sigma`/`keywords` unchanged.)
- [ ] Implement the `equation` render branch in `editor-dialogs.tsx`, added next to the `citationLookup` branch:
  ```tsx
  if (request?.kind === 'equation') {
    return (
      <EquationAddDialog
        open
        onClose={() => settle(null)}
        onInsert={(latex, display) => settle({ kind: 'equation', latex, display })}
      />
    );
  }
  ```
  Add `import { EquationAddDialog } from '@/components/editor/blocks/equation-add-dialog';` at the top.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/editor/equation-slash.test.ts`.
- [ ] Commit: `feat(editor): route /equation through live-preview modal instead of empty node (#246 #274)`

---

## E1b — `/citation` DOI auto-fetch in the manual modal (#274, #104 family)

The manual `/citation` modal currently collects free-text author/title/year/DOI/PubMed with no lookup. Add a DOI auto-fetch affordance to the *generic* citation form so a user pasting a DOI gets author/title/year auto-filled from `/api/citations/lookup` (the same endpoint `/cite-doi` uses), unifying the two citation entry points behind one modal interaction (#274). The `/cite-doi` lookup-only dialog stays as-is.

**Files:**
- Modify `src/components/editor/editor-dialogs.tsx` (augment the generic form: when the active request is `citation`, render a "Fetch from DOI" button beside the DOI field that calls `/api/citations/lookup` and populates author/title/year)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create `tests/components/editor/citation-modal-doi-fetch.test.tsx`

TDD steps:

- [ ] Write failing test `tests/components/editor/citation-modal-doi-fetch.test.tsx`: render `<EditorDialogs />`, drive `openEditorDialog({ kind: 'citation', title: 'Citation' })`, type `10.1234/abc` into the DOI field, mock `global.fetch` to resolve `/api/citations/lookup?doi=10.1234%2Fabc` → `{ meta: { authors: [{ family: 'Smith', given: 'J' }], title: 'A Paper', year: 2021, doi: '10.1234/abc' }, formatted: { apa: '...', mla: '...', chicago: '...' } }`, click the button with text matching `editor.citation.fetchDoi`, assert (await `findByDisplayValue`) the Author field shows `Smith, J`, Title shows `A Paper`, Year shows `2021`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/editor/citation-modal-doi-fetch.test.tsx`.
- [ ] Implement in `editor-dialogs.tsx`. Add a local `fetchFromDoi` helper inside `EditorDialogs` that runs only when `request?.kind === 'citation'`. It reads `values.doi`, classifies with the same `/^10\..+\/.+$/` DOI / `/^\d{6,9}$/` PMID regexes used in `citation-add-dialog.tsx`, fetches `/api/citations/lookup?{kind}={value}`, and on success sets:
  ```ts
  const a = data.meta.authors[0];
  setValues((v) => ({
    ...v,
    author: a ? (a.given ? `${a.family}, ${a.given}` : a.family) : v.author,
    title: data.meta.title ?? v.title,
    year: data.meta.year != null ? String(data.meta.year) : v.year,
  }));
  ```
  Render the trigger inside the generic form only for `citation` (gate on `request.kind === 'citation'`), placed under the fields, with an inline loading/error line (`aria-live="polite"`):
  ```tsx
  {request.kind === 'citation' && (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={doiLoading || !values.doi?.trim()}
        onClick={() => void fetchFromDoi()}
      >
        {t('editor.citation.fetchDoi')}
      </Button>
      <p aria-live="polite" className="text-muted-foreground text-xs">
        {doiLoading ? t('editor.citation.fetching') : doiError ? t('editor.citation.fetchFailed') : ''}
      </p>
    </div>
  )}
  ```
  Add `doiLoading`/`doiError` `useState` and an `AbortController` ref (abort prior fetch on re-click) mirroring `citation-add-dialog.tsx`. Reset `doiLoading`/`doiError` in the existing `subscribeEditorDialog` handler when a new request arrives.
- [ ] Add the three strings to each message file. `messages/en.json`:
  ```json
  "editor.citation.fetchDoi": "Fetch from DOI",
  "editor.citation.fetching": "Looking up…",
  "editor.citation.fetchFailed": "Lookup failed. Enter details manually."
  ```
  `messages/es.json`:
  ```json
  "editor.citation.fetchDoi": "Obtener desde DOI",
  "editor.citation.fetching": "Buscando…",
  "editor.citation.fetchFailed": "Búsqueda fallida. Introduce los datos manualmente."
  ```
  `messages/ar.json`:
  ```json
  "editor.citation.fetchDoi": "جلب من DOI",
  "editor.citation.fetching": "جارٍ البحث…",
  "editor.citation.fetchFailed": "فشل البحث. أدخل التفاصيل يدويًا."
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/editor/citation-modal-doi-fetch.test.tsx`.
- [ ] Run i18n parity check: `source ~/.zshenv && pnpm lint` (0 new findings).
- [ ] Commit: `feat(editor): add DOI auto-fetch to manual citation modal (#274)`

---

## E1c — `/footnote` modal confirmed on shared pattern + a11y-label parity (#274, #64, #246)

`/footnote` already opens the generic form modal (single `text` field). The remaining E1 unification work is small: confirm via test that all four input slash commands (`/equation`, `/citation`, `/footnote`, `/flashcard`) reach a modal (none drop a bare node), and that the footnote dialog's confirm label is i18n-driven rather than the hardcoded English `'Add'` in `SPECS`. This closes the "inconsistent slash ergonomics" gap (#274) and the footnote-input-affordance thread (#64/#246 family).

**Files:**
- Modify `src/components/editor/editor-dialogs.tsx` (drive `SPECS[*].confirmLabel` and the generic `confirmLabel`/footnote field label through `useT()` instead of literals)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create `tests/components/editor/slash-modal-consistency.test.ts`

TDD steps:

- [ ] Write failing test `tests/components/editor/slash-modal-consistency.test.ts`: import `SLASH_ITEMS`, spy on `openEditorDialog`. For each of the titles `Equation`, `Citation`, `Footnote`, `Flashcard`, call the matching item's `command` against a chained editor stub and assert `openEditorDialog` was invoked exactly once per item (i.e. every input command is modal-first). Assert the spy was NOT called for a non-input control item (`Heading 1`) as a negative check.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/editor/slash-modal-consistency.test.ts` (fails today because `/equation` would not call `openEditorDialog` until E1a lands; with E1a merged first this test asserts the unified state — order E1c after E1a).
- [ ] Implement i18n of confirm labels in `editor-dialogs.tsx`. Replace the static `SPECS` `confirmLabel`/field-`label` literals with keys, resolved at render via `t(...)`. Change the `SPECS` map values to carry i18n keys and resolve them where rendered:
  - footnote: `confirmLabel: t('common.add')`, field label `t('editor.footnote.textLabel')`.
  - citation: `confirmLabel: t('editor.citation.insert')`.
  - flashcard: `confirmLabel: t('common.add')`, field labels `t('editor.flashcard.front')` / `t('editor.flashcard.back')` / `t('editor.flashcard.deck')`.
  Do this by moving `SPECS` inside the component (or a `useMemo(() => ..., [t])`) so it can call `t`; the field `label` field already exists on `EditorDialogField`.
- [ ] Add the strings. `messages/en.json`:
  ```json
  "editor.footnote.textLabel": "Footnote text",
  "editor.citation.insert": "Insert",
  "editor.flashcard.front": "Front (question)",
  "editor.flashcard.back": "Back (answer)",
  "editor.flashcard.deck": "Deck tag (optional)"
  ```
  `messages/es.json`:
  ```json
  "editor.footnote.textLabel": "Texto de la nota al pie",
  "editor.citation.insert": "Insertar",
  "editor.flashcard.front": "Anverso (pregunta)",
  "editor.flashcard.back": "Reverso (respuesta)",
  "editor.flashcard.deck": "Etiqueta de mazo (opcional)"
  ```
  `messages/ar.json`:
  ```json
  "editor.footnote.textLabel": "نص الحاشية",
  "editor.citation.insert": "إدراج",
  "editor.flashcard.front": "الوجه (سؤال)",
  "editor.flashcard.back": "الظهر (إجابة)",
  "editor.flashcard.deck": "وسم المجموعة (اختياري)"
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/editor/slash-modal-consistency.test.ts`.
- [ ] Run i18n parity check: `source ~/.zshenv && pnpm lint` (0 new findings).
- [ ] Commit: `refactor(editor): i18n slash-modal labels + assert all input commands are modal-first (#274 #64)`

---

## E2 — Comment composer: preserve trailing text after `@`-mention pick (#73, #253)

When a user types `@`, picks a member, then keeps typing (`@[Jon](uuid) and the rest`), the persisted comment loses the text typed after the mention. Prior investigation established the composer caret is correct, so the loss is in the **write/serialization path**. This task starts with a systematic-debugging bisection (failing test reproducing the loss) across the three candidate layers — composer `getText()` serialization, `createComment` body handling in `src/lib/comments/create.ts`, and the POST route `z.string()` parse — then applies the minimal fix at the confirmed layer.

**REQUIRED SUB-SKILL: superpowers:systematic-debugging** (form the hypothesis, write the reproducing test, bisect before editing).

**Files:**
- Create `tests/lib/comments/mention-serialization.test.ts` (reproduction + regression guard at the lib layer; uses real Postgres via the shared Testcontainers helper)
- Create `tests/components/editor/comment-composer-mention.test.tsx` (composer `onChange` serialization reproduction at the UI layer)
- Modify the confirmed-faulty layer: most likely `src/components/comments/comment-composer.tsx` (the `onUpdate`/`getText` serializer) and/or `src/components/editor/mention-extension.ts` (`renderText` / suggestion `command`); `src/lib/comments/create.ts` only if the bisection points there.

TDD steps:

- [ ] **Bisect — lib layer.** Write failing test `tests/lib/comments/mention-serialization.test.ts` using the shared Testcontainers db helper (`tests/helpers/db.ts`, `startPostgres`/`stopPostgres`, TRUNCATE in `beforeEach`). Seed a workspace + author + a page, then call `createComment(db, { workspaceId, authorId, body: '@[Jon](11111111-1111-1111-1111-111111111111) and the rest', target: { type: 'page', id: pageId } })` and assert the persisted `comment.body` equals the full input string verbatim (trailing ` and the rest` intact) and `mentionedUserIds` equals `['11111111-1111-1111-1111-111111111111']`.
- [ ] Run: `source ~/.zshenv && pnpm vitest run tests/lib/comments/mention-serialization.test.ts`. **Expected: PASS** (this confirms `createComment` + the POST `z.string().min(1).max(10_000)` parse do NOT truncate — the body is stored verbatim). Keep this test as a regression guard either way. If it unexpectedly fails, the bug is server-side: fix `create.ts` (the `input.body.trim()` only trims ends; do not collapse interior — verify no over-eager normalization) and stop here.
- [ ] **Bisect — composer serialization layer.** Write failing test `tests/components/editor/comment-composer-mention.test.tsx`: mount `<CommentComposer value="" onChange={spy} />`, programmatically insert a mention then trailing text via the editor instance (use TipTap's `editor.commands` through a test handle, or simulate the mention node insert with `insertContentAt` + typed text exactly as `mention-extension.ts`'s `command` does, then type ` and the rest`). Assert the last `onChange` call received `@[Jon](11111111-1111-1111-1111-111111111111) and the rest` — i.e. `editor.getText()` serialized the mention via `renderText` AND retained the trailing text. **This is the test expected to fail and pin the bug.**
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/editor/comment-composer-mention.test.tsx`.
- [ ] **Diagnose.** The suspect is `editor.getText()` in `comment-composer.tsx#onUpdate`. TipTap 3's bare `getText()` only applies a node's `renderText` when text serializers are supplied; without `textSerializers`, the `mention` atom serializes to its node-default (often the empty string or the leaf text), which can swallow adjacent inline content depending on `blockSeparator` handling. Confirm by logging the actual `onChange` payload in the failing test before fixing.
- [ ] **Fix (composer serializer).** In `comment-composer.tsx`, make `onUpdate` serialize through the mention node's `renderText` explicitly so the stored token and surrounding text both survive:
  ```ts
  import { MentionExtension } from '@/components/editor/mention-extension';
  // ...
  onUpdate: ({ editor: ed }) => {
    onChange(
      ed.getText({
        textSerializers: {
          mention: ({ node }) =>
            `@[${node.attrs.label ?? node.attrs.id}](${node.attrs.id})`,
        },
      }),
    );
  },
  ```
  (Source the serializer from the same convention as `mention-extension.ts#renderText` — keep them identical. If TS complains about the `getText` options shape under TipTap 3, import `getTextSerializersFromSchema`/`TextSerializer` types from `@tiptap/core` and type the map accordingly.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/editor/comment-composer-mention.test.tsx`.
- [ ] Re-run the lib guard to confirm no regression end-to-end: `source ~/.zshenv && pnpm vitest run tests/lib/comments/mention-serialization.test.ts`.
- [ ] Commit: `fix(comments): preserve text typed after an @-mention in the composer (#73 #253)`

---

## E-GATE — Plan E verification gate (single PR onto `patches/v0.9.9`, HOLD for GO)

Run every check below from a clean tree; all must pass with zero deferrals before opening the PR. GitHub-hosted runners only.

- [ ] Lint, zero errors: `source ~/.zshenv && pnpm lint` → 0 errors (Biome v2; includes the i18n missing-key rule — confirm the new `editor.equation.*`, `editor.citation.*`, `editor.footnote.*`, `editor.flashcard.*` keys exist in all of en/es/ar with no orphans).
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck` → 0 errors (verify the `EditorDialogSpec`/`EditorDialogResult` union extensions and the `getText` serializer typing compile under TS6 strict).
- [ ] i18n none-new audit: confirm no key was added to one locale and missed in another (diff the three message files' key sets; the lint rule above enforces this, but re-confirm manually for the 16 new keys introduced by E1a/E1b/E1c).
- [ ] Full test suite: `source ~/.zshenv && pnpm vitest run` (FULL run, not scoped — Testcontainers Postgres required; isolation stays ON per the project gotcha). All green.
- [ ] Build: `source ~/.zshenv && pnpm build` → succeeds (Next 16 standalone + entrypoint tsc).
- [ ] **e2e UI-acceptance gate (editor group — route-reachability + per-feature deployed-image check):**
  - Route smoke: a page editor route loads against the built image without console errors.
  - Per-feature deployed-image checklist (verify on the running image, not just unit mocks):
    1. `/equation` → modal opens with a LaTeX field; typing `\frac{1}{2}` shows a rendered KaTeX preview; Insert places a populated `math` node (no empty-node + extra click); Cancel leaves no stray `/` (relies on Plan A A3).
    2. `/citation` → modal opens; "Fetch from DOI" with a valid DOI populates Author/Title/Year from `/api/citations/lookup`; Insert places a `citation` node.
    3. `/footnote` → modal opens with a single text field; Add inserts the footnote mark.
    4. `/flashcard` → unchanged modal still works (regression check).
    5. Comment composer → type `@`, pick a member, continue typing trailing text, submit; reload and confirm the persisted comment shows the mention pill followed by the trailing text (no truncation).
- [ ] Open a single PR onto `patches/v0.9.9` titled `Plan E — Slash Command UX Consistency (#246 #274 #64 #73 #253)`, listing the closed issues, noting the Plan A A3 dependency, and the e2e-acceptance results. **HOLD — do not merge; await user GO.**
