# v0.9.9 Plan D — Editor Polish & A11y

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the v0.9.8-audit editor findings that survived prior releases as polish/a11y debt: toolbar tooltips + ARIA (#10/#189), submit-for-review hierarchy (#11/#190), lock-mode control visibility (#9/#188), markdown correctness (`**bold**` markers, `~~strike~~` input rule, CSS quote bleed — #83/#84/#86 = #260/#261/#262), a richer selection bubble toolbar (#107/#275), heading-collapse hover affordance (#108/#276), a block right-click context menu (#101/#271), and replacing the tiny outline popover with a full drawer (#55/#234). Every new control gets an accessible name + visible tooltip + en/es/ar string; nothing regresses Yjs sync (all editor mutations remain attr/transaction-only).

**Architecture:** All editor surfaces are TipTap 3 client components under `src/components/editor/`. Tooltips and the block context menu use the already-vendored unified `radix-ui` package (`Tooltip`, `ContextMenu`) — the same import style as `src/components/sidebar/page-row-context-menu.tsx` (`import { ContextMenu } from 'radix-ui'`). The page action bar lives in `src/components/pages/page-action-panels.tsx`; the editor shell + control-visibility gates live in `src/components/editor/editor.tsx`. Markdown input rules attach via `Bold.extend`/`Strike.extend` `addInputRules()` merged into `baseExtensions()` (`src/components/editor/extensions.ts`). The outline drawer copies the right-side `fixed inset-y-0 right-0` drawer pattern from `src/components/pages/version-history.tsx`. Heading-collapse uses the existing `collectHeadings`/`scrollIntoView` machinery + a hover chevron rendered by a ProseMirror decoration-free DOM overlay reusing the `DragHandle` mousemove approach. i18n catalogs are flat dotted-key JSON in `messages/{en,es,ar}.json`, loaded by `src/lib/i18n/messages.ts`; UI reads them via `useT()` from `src/lib/i18n/provider`.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 strict · TipTap 3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/core`) · `radix-ui` v1.4.3 (Tooltip, ContextMenu) · Tailwind v4 (`@theme` in `src/app/globals.css`) + shadcn/ui (new-york) · Biome v2 · Vitest 4 + Testcontainers v12 · Drizzle + Postgres 16 · i18n en/es/ar via `useT()`.

**Migrations:** None. Plan D is presentation/editor-only; no schema change. (v0.9.9 migrations start at 0062 and are owned by other plans — Plan D does not consume a migration number.)

---

## D1 — Toolbar tooltips + ARIA via Radix Tooltip (#10 / #189)

**Cause:** The page action bar buttons (Comments / History / Lock) carry `aria-label`s but no visible hover tooltip — v0.9.7's "tooltip" work was scoped to the automation builder, not this bar (`page-action-panels.tsx` mounts `CommentsToggle`, `VersionHistory`, `LockToggle`, none of which wrap their trigger in a Tooltip). Add a shared `IconTooltip` wrapper using `radix-ui`'s `Tooltip`, then wrap the three triggers.

**Files:**
- Create `src/components/ui/tooltip.tsx`
- Create `src/components/ui/tooltip.test.tsx`
- Modify `src/components/pages/page-action-panels.tsx`
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Write failing test `src/components/ui/tooltip.test.tsx`: render `<TooltipProvider><IconTooltip label="Comments"><button>x</button></IconTooltip></TooltipProvider>`; assert the trigger button is rendered and that `screen.getByRole('button')` carries `aria-describedby` is NOT required at rest, but on `fireEvent.focus` the tooltip content `Comments` appears (`await screen.findByText('Comments')`). Also assert the trigger keeps its own `aria-label` untouched (tooltip is supplementary, not the only name).
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/ui/tooltip.test.tsx` → fails (module missing).
- [ ] Create `src/components/ui/tooltip.tsx`:
  ```tsx
  'use client';

  import { Tooltip as RadixTooltip } from 'radix-ui';
  import type { ReactNode } from 'react';

  export const TooltipProvider = RadixTooltip.Provider;

  /**
   * #189 — supplementary hover/focus tooltip for icon-only controls. The wrapped
   * trigger MUST already carry its own `aria-label` (the tooltip is decorative,
   * not the accessible name) so SR users are unaffected if the tooltip never
   * opens. Radix manages keyboard focus + Esc dismissal + delay.
   */
  export function IconTooltip({
    label,
    children,
    side = 'bottom',
  }: {
    label: string;
    children: ReactNode;
    side?: 'top' | 'bottom' | 'left' | 'right';
  }) {
    return (
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
          >
            {label}
            <RadixTooltip.Arrow className="fill-popover" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    );
  }
  ```
- [ ] Run the test → passes.
- [ ] Commit: `feat(editor): add IconTooltip radix wrapper for icon controls`
- [ ] Add i18n keys (include in this step):
  ```json
  // messages/en.json
  "pageActions.tooltip.comments": "Comments",
  "pageActions.tooltip.history": "Version history",
  "pageActions.tooltip.lock": "Lock page"
  ```
  ```json
  // messages/es.json
  "pageActions.tooltip.comments": "Comentarios",
  "pageActions.tooltip.history": "Historial de versiones",
  "pageActions.tooltip.lock": "Bloquear página"
  ```
  ```json
  // messages/ar.json
  "pageActions.tooltip.comments": "التعليقات",
  "pageActions.tooltip.history": "سجل الإصدارات",
  "pageActions.tooltip.lock": "قفل الصفحة"
  ```
- [ ] Write failing test (extend `src/components/pages/page-action-panels.test.tsx` or create it): render `<PageActionPanels .../>` with `canLock canComment canEditVersions`; assert the Comments/History/Lock triggers are each wrapped so that on `fireEvent.focus(getByLabelText('Comments'))` the tooltip text `Comments` appears via `findByText`. Use a test `useT` returning the literal key→label map.
- [ ] Run → fails (no tooltips wired).
- [ ] In `page-action-panels.tsx`, wrap the returned fragment in `<TooltipProvider delayDuration={300}>` and wrap each of `CommentsToggle`, `VersionHistory`, `LockToggle` in `<IconTooltip label={t('pageActions.tooltip.comments'|'.history'|'.lock')} side="bottom">`. Import `{ IconTooltip, TooltipProvider }` from `@/components/ui/tooltip`. Keep the existing `aria-label`s inside each child unchanged.
- [ ] Run → passes.
- [ ] Commit: `fix(pages): add hover tooltips to comments/history/lock toolbar (#189)`

---

## D2 — Submit-for-review hierarchy: variant=default (#11 / #190)

**Cause:** `submit-for-review-button.tsx:43` renders `<Button variant="outline">`, the same low-emphasis variant as its neighboring actions, so the primary CTA does not stand out. Promote it to `variant="default"` (the primary fill) so it reads as the page's call to action.

**Files:**
- Modify `src/components/pages/submit-for-review-button.tsx`
- Create `src/components/pages/submit-for-review-button.test.tsx`

Steps:
- [ ] Write failing test `src/components/pages/submit-for-review-button.test.tsx`: render `<SubmitForReviewButton pageId="p1" />`; assert the button does NOT carry the outline classes and IS the default (primary) variant. Concretely: `const btn = screen.getByRole('button', { name: /submit/i }); expect(btn.className).toContain('bg-primary');` (the shadcn `default` variant emits `bg-primary text-primary-foreground`; `outline` emits `border bg-background`). Stub `useT` to return keys.
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/pages/submit-for-review-button.test.tsx` → fails (button is `bg-background` outline).
- [ ] Edit `submit-for-review-button.tsx:43` from `variant="outline"` to `variant="default"`.
- [ ] Run → passes.
- [ ] Commit: `fix(pages): promote submit-for-review to primary variant (#190)`

---

## D3 — Lock mode keeps Suggest-edits + Bibliography visible-disabled (#9 / #188)

**Cause:** `editor.tsx:122` computes `effectiveEditable = editable && !readerMode && !locked`, and the JSX at `editor.tsx:560` gates the *entire* suggest-edits + bibliography group on `effectiveEditable`, so locking a page makes both controls vanish instead of showing as disabled. Per the fix sketch: keep the controls visible-disabled under lock; gate Bibliography on `editable` alone (it is a read-time aid, not an edit action).

The cleanest split: introduce a `locked`-aware boolean that keeps the group mounted whenever the user *could* edit (`editable && !readerMode`) and pass a `disabled` flag down. Bibliography uses `editable` (ignores `locked`), so a locked page still renders its bibliography toggle.

**Files:**
- Modify `src/components/editor/editor.tsx`
- Modify `src/components/editor/suggestion-toolbar.tsx`
- Modify `src/components/editor/bibliography-toggle.tsx`
- Create `src/components/editor/editor-lock-visibility.test.tsx`
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Write failing test `src/components/editor/editor-lock-visibility.test.tsx`: mount the `<Editor>` shell (mock `useCollabDoc` to return a synthetic `provider`/`ydoc`/`status`, mock `usePageModeOptional` to `{ reader: false }`). Render once with `editable locked` and assert the SuggestionToolbar trigger is present in the DOM but `disabled` (`getByRole('button', { name: /suggest/i })` has `disabled`), and that the BibliographyToggle is present (NOT removed). Render again with `editable` + `locked={false}` and assert the SuggestionToolbar is enabled.
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/editor/editor-lock-visibility.test.tsx` → fails (group is fully unmounted under lock).
- [ ] In `editor.tsx`, add after line 122:
  ```tsx
  // #188 — controls that represent an *edit affordance* stay mounted but
  // disabled while the page is locked, rather than disappearing (which read as
  // a broken UI). `mountableEditable` = the user could edit if not locked;
  // `editLocked` = currently suppressed by a lock only.
  const mountableEditable = editable && !readerMode;
  const editLocked = mountableEditable && locked;
  ```
- [ ] In `editor.tsx`, change the group gate at line 560 from `{effectiveEditable && (` to `{mountableEditable && (` and:
  - Pass `disabled={editLocked}` to `<SuggestionToolbar>`.
  - Keep `<SuggestionsDrawer>` mounting unchanged (it is harmless under lock; opening is driven by the toolbar which is now disabled).
  - Change the `<BibliographyToggle>` gate so it renders whenever `editable` is true regardless of `locked` — i.e. move it out from under the `effectiveEditable` group if needed, OR keep it in the `mountableEditable` group (which is `editable && !readerMode`, already lock-independent). Since `mountableEditable` does not include `!locked`, the Bibliography toggle now survives lock. Confirm `onChange`/`citationCount` props are unchanged.
- [ ] In `suggestion-toolbar.tsx`, add an optional `disabled?: boolean` prop; when true, set `disabled` on the toggle button(s) and add `aria-disabled="true"` + a tooltip/`title={t('editor.suggest.lockedHint')}`. Do not change the toggle handlers (they simply won't fire while disabled).
- [ ] Add i18n keys:
  ```json
  // messages/en.json
  "editor.suggest.lockedHint": "Unlock the page to suggest edits"
  ```
  ```json
  // messages/es.json
  "editor.suggest.lockedHint": "Desbloquea la página para sugerir cambios"
  ```
  ```json
  // messages/ar.json
  "editor.suggest.lockedHint": "ألغِ قفل الصفحة لاقتراح التعديلات"
  ```
- [ ] Run → passes.
- [ ] Commit: `fix(editor): keep suggest-edits + bibliography visible-disabled under lock (#188)`

---

## D4 — Markdown correctness: strip `**` bold markers, add `~~strike~~` input rule, restrict CSS quotes to inline `q` (#83/#84/#86 = #260/#261/#262)

**Cause (a) #260:** Typing `**bold**` leaves the literal `**` delimiters in the text because StarterKit's bold mark input rule was not stripping the markers in this build. **(b) #262:** Tailwind typography's `prose` adds `q::before { content: open-quote }` / `q::after { content: close-quote }`, but those quote glyphs bleed onto `blockquote` and `li` content because the project's prose styling applies `content: '"'` too broadly — scope generated quotes to inline `<q>` only. **(c) #261 (companion #84):** there is no `~~double-tilde~~` strikethrough input rule, so typing it does nothing.

Implement bold/strike input rules via `Bold.extend`/`Strike.extend` `addInputRules()` using TipTap's `markInputRule`, and scope the CSS `q` quote content.

**Files:**
- Create `src/components/editor/marks/markdown-input-rules.ts`
- Create `src/components/editor/marks/markdown-input-rules.test.ts`
- Modify `src/components/editor/extensions.ts`
- Modify `src/components/editor/blocks.css` (or `code-highlight.css` if prose quote rules live there — grep first)

Steps:
- [ ] Write failing test `src/components/editor/marks/markdown-input-rules.test.ts`: build a TipTap `Editor` (jsdom, `immediatelyRender: false`) with `baseExtensions()`. Programmatically run the bold input rule by inserting `**x**` and triggering the rule (use `editor.commands.insertContent` + simulate the trailing trigger char, or assert directly that `boldInputRule`/`strikeInputRule` regexes match `**x**` / `~~x~~` and yield a marked range with the delimiters removed). Minimum viable assertion that runs in jsdom: `expect(STRIKE_INPUT_RE.test('~~x~~')).toBe(true)` and `expect(BOLD_INPUT_RE.test('**x**')).toBe(true)`, and a unit test of a helper `stripDelimiters('**x**', '**')` → `'x'`. Then assert `baseExtensions()` includes a Strike mark whose `addInputRules()` returns a non-empty array.
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/editor/marks/markdown-input-rules.test.ts` → fails (module missing).
- [ ] Create `src/components/editor/marks/markdown-input-rules.ts`:
  ```ts
  import Bold from '@tiptap/extension-bold';
  import Strike from '@tiptap/extension-strike';
  import { markInputRule } from '@tiptap/core';

  // #260 / #261 — markdown shorthand input rules that DELETE their delimiters.
  // `markInputRule` replaces the matched range (group 1 is the inner text) with
  // the marked text, so the `**`/`~~` markers are stripped, not left as literals.
  export const BOLD_INPUT_RE = /(?:^|\s)(\*\*([^*]+)\*\*)$/;
  export const STRIKE_INPUT_RE = /(?:^|\s)(~~([^~]+)~~)$/;

  export const CairnBold = Bold.extend({
    addInputRules() {
      return [markInputRule({ find: BOLD_INPUT_RE, type: this.type })];
    },
  });

  export const CairnStrike = Strike.extend({
    addInputRules() {
      return [markInputRule({ find: STRIKE_INPUT_RE, type: this.type })];
    },
  });
  ```
- [ ] In `extensions.ts`, disable StarterKit's built-in bold + strike so the extended variants own the schema, and add the extended marks. In the `StarterKit.configure({...})` call add `bold: false, strike: false,`; import `{ CairnBold, CairnStrike }` from `./marks/markdown-input-rules`; push `CairnBold, CairnStrike` into the returned extensions array (after the StarterKit entry, before custom nodes). Verify TipTap dedupes by mark name so the bubble menu's `toggleBold`/`toggleStrike` still resolve.
- [ ] Run the test → passes.
- [ ] Commit: `fix(editor): strip ** and ~~ markdown delimiters via input rules (#260 #261)`
- [ ] Write failing CSS-scope test: add to `markdown-input-rules.test.ts` (or a `prose-quotes.test.ts`) a string-assertion over the compiled rule source — read the css file and assert it does NOT contain an unscoped `blockquote` + `content: open-quote`, and DOES contain a `q::before`/`q::after` (or `.prose q`) scoped rule. (We assert on the authored CSS file text since jsdom doesn't compute Tailwind `content`.)
  - Run → fails.
- [ ] Grep for the offending rule first: `source ~/.zshenv && cd /Users/jon/projects/cairn && grep -rn "open-quote\|content:.*\\\"\|content: quotes\|blockquote" src/components/editor/*.css src/app/globals.css`. Add a scoped override in the prose CSS file that emits quote glyphs only for inline `<q>` and explicitly clears them on `blockquote`/`li`:
  ```css
  /* #262 — Typography's generated quotes must apply ONLY to inline <q>, not to
     blockquote or list items (where they bled in as stray glyphs). */
  .prose q::before { content: open-quote; }
  .prose q::after { content: close-quote; }
  .prose blockquote::before,
  .prose blockquote::after,
  .prose li::before,
  .prose li::after {
    content: none;
  }
  ```
- [ ] Run → passes.
- [ ] Commit: `fix(editor): scope generated quotes to inline q, clear on blockquote/li (#262)`

---

## D5 — Selection bubble toolbar: color/highlight/turn-into H1–3/comment-on-selection ⌘⇧M/align/sub-sup/inline-math (#107 / #275)

**Cause:** `editor-bubble-menu.tsx` only offers bold/italic/strike/code/link/clear. The audit wants a richer Notion-style selection toolbar. Add: text color + highlight (TipTap `@tiptap/extension-color` + `@tiptap/extension-highlight`, both Yjs-safe marks/attrs), turn-into H1/H2/H3 (`toggleHeading`), comment-on-selection bound to ⌘⇧M (dispatch a `cairn:editor:comment-selection` window event the comments rail listens for), align left/center/right (`@tiptap/extension-text-align`), sub/superscript (`@tiptap/extension-subscript`/`-superscript`), and inline math (insert the existing `math` inline node via the lazy loader). Group with separators; every control gets `aria-label` + `IconTooltip`.

Note on deps: prefer extensions already in the bundle. Color/Highlight/TextAlign/Subscript/Superscript are the official TipTap mark/attr extensions and are Yjs-safe (attrs only). If any are not yet installed, `pnpm add @tiptap/extension-color @tiptap/extension-highlight @tiptap/extension-text-align @tiptap/extension-subscript @tiptap/extension-superscript` (pinned to the TipTap 3 line) — record in the commit.

**Files:**
- Modify `src/components/editor/extensions.ts` (register Color, Highlight, TextAlign, Subscript, Superscript — all Yjs-safe; extend the SAFE-review comment block)
- Modify `src/components/editor/editor-bubble-menu.tsx`
- Modify `src/components/editor/editor.tsx` (register the ⌘⇧M comment-selection shortcut + dispatch event; the comments rail listens)
- Create `src/components/editor/editor-bubble-menu.test.tsx` (extend if exists)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Write failing test `src/components/editor/editor-bubble-menu.test.tsx`: build an editor with `baseExtensions()` and a non-empty text selection; render `<EditorBubbleMenu editor={editor} />`. Assert presence of new controls by accessible name: `getByLabelText('Text color')`, `getByLabelText('Highlight')`, `getByLabelText('Heading 1')`, `getByLabelText('Comment')`, `getByLabelText('Align left')`, `getByLabelText('Superscript')`, `getByLabelText('Inline math')`. Assert clicking `Heading 1` calls `editor.chain().toggleHeading({ level: 1 })` (spy on `editor.chain`). Assert clicking `Comment` dispatches a `cairn:editor:comment-selection` window event (attach a listener in the test).
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/editor/editor-bubble-menu.test.tsx` → fails.
- [ ] In `extensions.ts`: import and register `Color`, `Highlight.configure({ multicolor: true })`, `TextAlign.configure({ types: ['heading', 'paragraph'] })`, `Subscript`, `Superscript`. Extend the SAFE-review JSDoc block with one-line entries for each (e.g. `Highlight — mark, attr {color} only. SAFE`). Note: `Color` requires `@tiptap/extension-text-style`'s `TextStyle` — register it too if absent.
- [ ] In `editor-bubble-menu.tsx`, add a second control row (or grouped clusters with `<span className="mx-0.5 h-5 w-px bg-border" />` separators):
  - Text color + Highlight: small swatch buttons that call `editor.chain().focus().setColor('#…').run()` / `setHighlight({ color })` (a 6-swatch mini palette popover is acceptable; minimal viable = one "default accent" + "clear" each).
  - Turn-into: three buttons `Heading 1/2/3` → `editor.chain().focus().toggleHeading({ level }).run()` with `data-active={editor.isActive('heading', { level })}`.
  - Comment: button calling `() => window.dispatchEvent(new CustomEvent('cairn:editor:comment-selection'))`, `title={`${t('editor.bubble.comment')} (⌘⇧M)`}`.
  - Align left/center/right → `setTextAlign('left'|'center'|'right')`.
  - Sub/superscript → `toggleSubscript()` / `toggleSuperscript()`.
  - Inline math → load the lazy `math` extension then `editor.chain().focus().insertContent({ type: 'math', attrs: { latex: '', display: false } }).run()` (reuse the `loadEditorExtension('math')` path from `editor.tsx`).
  Each button: `type="button"`, `aria-label={t(...)}`, wrapped in `IconTooltip`, class `cn(BTN)`.
- [ ] In `editor.tsx`, add a keymap entry / window-level keydown for ⌘⇧M (Mod+Shift+M) that dispatches `cairn:editor:comment-selection` when there is a non-empty selection and `effectiveEditable`. (Mirror the existing `cairn:editor:open-link` pattern.) The comments rail (`comments-toggle.tsx` / `comment-panel.tsx`) listens for this event to open the composer pre-anchored to the selection — if that wiring is out of Plan D's scope, dispatch the event and leave a `// TODO wired by comments plan` is NOT acceptable (zero-deferral): wire a minimal listener in `comments-toggle.tsx` that opens the rail.
- [ ] Add i18n keys:
  ```json
  // messages/en.json
  "editor.bubble.color": "Text color",
  "editor.bubble.highlight": "Highlight",
  "editor.bubble.clearColor": "Clear color",
  "editor.bubble.h1": "Heading 1",
  "editor.bubble.h2": "Heading 2",
  "editor.bubble.h3": "Heading 3",
  "editor.bubble.comment": "Comment",
  "editor.bubble.alignLeft": "Align left",
  "editor.bubble.alignCenter": "Align center",
  "editor.bubble.alignRight": "Align right",
  "editor.bubble.subscript": "Subscript",
  "editor.bubble.superscript": "Superscript",
  "editor.bubble.inlineMath": "Inline math"
  ```
  ```json
  // messages/es.json
  "editor.bubble.color": "Color de texto",
  "editor.bubble.highlight": "Resaltado",
  "editor.bubble.clearColor": "Quitar color",
  "editor.bubble.h1": "Encabezado 1",
  "editor.bubble.h2": "Encabezado 2",
  "editor.bubble.h3": "Encabezado 3",
  "editor.bubble.comment": "Comentar",
  "editor.bubble.alignLeft": "Alinear a la izquierda",
  "editor.bubble.alignCenter": "Centrar",
  "editor.bubble.alignRight": "Alinear a la derecha",
  "editor.bubble.subscript": "Subíndice",
  "editor.bubble.superscript": "Superíndice",
  "editor.bubble.inlineMath": "Matemáticas en línea"
  ```
  ```json
  // messages/ar.json
  "editor.bubble.color": "لون النص",
  "editor.bubble.highlight": "تمييز",
  "editor.bubble.clearColor": "إزالة اللون",
  "editor.bubble.h1": "عنوان 1",
  "editor.bubble.h2": "عنوان 2",
  "editor.bubble.h3": "عنوان 3",
  "editor.bubble.comment": "تعليق",
  "editor.bubble.alignLeft": "محاذاة لليسار",
  "editor.bubble.alignCenter": "توسيط",
  "editor.bubble.alignRight": "محاذاة لليمين",
  "editor.bubble.subscript": "منخفض",
  "editor.bubble.superscript": "مرتفع",
  "editor.bubble.inlineMath": "رياضيات مضمّنة"
  ```
- [ ] Run → passes.
- [ ] Commit: `feat(editor): expand selection bubble toolbar (color/highlight/headings/align/sub-sup/math/comment) (#275)`

---

## D6 — Heading collapse chevron on hover (#108 / #276)

**Cause:** Headings have no affordance to collapse the content beneath them. Add a `▾` chevron that appears on heading hover; clicking it collapses (visually hides) the blocks between this heading and the next heading of equal-or-higher level. Reuse the `DragHandle` mousemove-over-`h1,h2,h3` detection to position an overlay chevron in the left gutter; collapse state is per-heading in-memory (no schema change), persisted in component state keyed by the heading's doc position. (#273-style "keep title, hide children" semantics for the heading case.)

**Files:**
- Create `src/components/editor/heading-collapse.tsx`
- Create `src/components/editor/heading-collapse.test.tsx`
- Modify `src/components/editor/editor.tsx` (mount `<HeadingCollapse editor={editor} />` next to `<DragHandle>`)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Write failing test `src/components/editor/heading-collapse.test.tsx`: build an editor whose doc is `H2 "A"` then `paragraph "body"` then `H2 "B"`. Render `<HeadingCollapse editor={editor} />`. Simulate hover (mousemove) over the first `h2`; assert a button `getByLabelText('Collapse section')` appears. Click it; assert the paragraph between the two H2s gets `hidden` (or a `data-collapsed` attribute / `display:none` style applied to its DOM node), and the second `h2` "B" is NOT hidden. Click again → `getByLabelText('Expand section')` and the paragraph is visible.
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/editor/heading-collapse.test.tsx` → fails (module missing).
- [ ] Create `src/components/editor/heading-collapse.tsx`: a client component that
  - listens to `editor.view.dom` mousemove; when the target closes to `h1,h2,h3`, computes the heading's `posAtDOM` + level and renders an absolutely-positioned `ChevronDown`/`ChevronRight` button in the gutter (`left:-28`, mirroring DragHandle math).
  - on click toggles a `Set<number>` of collapsed heading positions; for each collapsed heading, walks following top-level siblings until the next heading with `level <= this.level`, and applies `node.dom.setAttribute('hidden','')` (or toggles a `.cairn-collapsed` class) to their rendered DOM via `editor.view.nodeDOM(pos)`. Recompute on `editor.on('update')` so edits don't desync the overlay.
  - This is a view-only collapse (no Yjs write — collapse is a per-viewer presentation state), keeping collab-safe.
  - button `aria-label` toggles between `t('editor.heading.collapse')` / `t('editor.heading.expand')`, `aria-expanded`, wrapped in `IconTooltip`.
- [ ] In `editor.tsx`, after `{editor && <DragHandle editor={editor} />}` add `{editor && <HeadingCollapse editor={editor} />}` inside the same `relative` editor-body wrapper.
- [ ] Add i18n keys:
  ```json
  // messages/en.json
  "editor.heading.collapse": "Collapse section",
  "editor.heading.expand": "Expand section"
  ```
  ```json
  // messages/es.json
  "editor.heading.collapse": "Contraer sección",
  "editor.heading.expand": "Expandir sección"
  ```
  ```json
  // messages/ar.json
  "editor.heading.collapse": "طيّ القسم",
  "editor.heading.expand": "توسيع القسم"
  ```
- [ ] Run → passes.
- [ ] Commit: `feat(editor): heading collapse chevron on hover (#276)`

---

## D7 — Block right-click context menu via Radix ContextMenu (#101 / #271)

**Cause:** Blocks have no right-click menu; the native browser context menu is the only thing available, and the rich `DragHandle` actions (Move up/down, Duplicate, Delete) are reachable only via the hover grip. Per the fix sketch, add a block context menu that reuses the `⋮⋮` handle actions plus Comment / Convert / Color / Copy-link. Mirror the sidebar pattern in `src/components/sidebar/page-row-context-menu.tsx` (`radix-ui`'s `ContextMenu`, keyboard-accessible, single source of truth for actions).

Strategy: extract the block-mutation actions currently inlined in `drag-handle.tsx` (`action('up'|'down'|'dup'|'del')`, `insertBelow`) into a shared hook `use-block-actions.ts` taking `(editor, targetPos)`, so both the DragHandle menu AND a new `BlockContextMenu` consume the same set (no divergence). Add Comment (dispatch `cairn:editor:comment-selection` at the block), Convert (open the existing `block-convert` flow), Color (set callout/highlight where applicable), and Copy-link (copy `/<page>#<blockId>` — use the heading slug or block position anchor).

**Files:**
- Create `src/components/editor/use-block-actions.ts`
- Create `src/components/editor/use-block-actions.test.ts`
- Create `src/components/editor/block-context-menu.tsx`
- Create `src/components/editor/block-context-menu.test.tsx`
- Modify `src/components/editor/drag-handle.tsx` (consume the shared hook — no behavior change)
- Modify `src/components/editor/editor.tsx` (mount the contextmenu handler over the editor surface)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Write failing test `src/components/editor/use-block-actions.test.ts`: build an editor with `paragraph "one"`, `paragraph "two"`. Call `const a = blockActions(editor, posOfSecond)`; `a.duplicate()` → doc now has three paragraphs with "two" duplicated; `a.delete()` → removed; `a.moveUp()` reorders. (Pure ProseMirror transactions — runnable in jsdom.) Assert each is a function.
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/editor/use-block-actions.test.ts` → fails (module missing).
- [ ] Create `use-block-actions.ts` exporting `blockActions(editor, targetPos)` returning `{ moveUp, moveDown, duplicate, delete: deleteBlock, insertBelow }` — move the exact transaction code out of `drag-handle.tsx:69-159` (the `action` switch + `insertBelow`) verbatim, parameterized on `targetPos`.
- [ ] Run → passes. Commit: `refactor(editor): extract shared blockActions hook from drag-handle`
- [ ] Edit `drag-handle.tsx` to call `blockActions(editor, targetPos)` for its menu items instead of the inline `action`/`insertBelow`; delete the now-duplicated inline bodies. Run `pnpm vitest run` for any existing drag-handle test → still passes. Commit: `refactor(editor): drag-handle consumes shared blockActions`
- [ ] Write failing test `src/components/editor/block-context-menu.test.tsx`: render `<BlockContextMenu editor={editor} targetPos={pos}><div data-testid="block" /></BlockContextMenu>`. Fire `contextMenu` on the child; assert items by name appear: `Duplicate`, `Delete`, `Comment`, `Convert`, `Color`, `Move up`, `Copy link`. Click `Duplicate` → block duplicated (spy or doc assertion). Click `Copy link` → `navigator.clipboard.writeText` called with a string containing the page anchor (mock clipboard).
- [ ] Run → fails (module missing).
- [ ] Create `block-context-menu.tsx`: copy the structure of `page-row-context-menu.tsx` — `<ContextMenu.Root><ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">…</ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>`. Items (each `<ContextMenu.Item>` with `t(...)` label):
  - Duplicate / Delete / Move up / Move down → `blockActions`.
  - Comment → `window.dispatchEvent(new CustomEvent('cairn:editor:comment-selection'))` after selecting the block.
  - Convert → open the existing `block-convert` menu (reuse `block-convert.ts`).
  - Color → set highlight/callout variant on the block (reuse the D5 highlight command for text blocks).
  - Copy link → `navigator.clipboard.writeText(`${location.origin}/pages/${pageId}#${anchor}`)` where `anchor` = heading slug (via `headingSlug`) for headings, else `block-${targetPos}`.
- [ ] In `editor.tsx`, wrap the `<EditorContent>` (or attach a `contextmenu` handler on the editor body that resolves the block at the event coords via `posAtCoords`, sets `targetPos`, and renders the `BlockContextMenu`). Gate on `effectiveEditable` for mutating items; read-only viewers still get Comment + Copy-link (non-mutating) — split the item list by `effectiveEditable`.
- [ ] Add i18n keys:
  ```json
  // messages/en.json
  "editor.block.duplicate": "Duplicate",
  "editor.block.delete": "Delete",
  "editor.block.comment": "Comment",
  "editor.block.convert": "Convert to",
  "editor.block.color": "Color",
  "editor.block.moveUp": "Move up",
  "editor.block.moveDown": "Move down",
  "editor.block.copyLink": "Copy link",
  "editor.block.copied": "Link copied"
  ```
  ```json
  // messages/es.json
  "editor.block.duplicate": "Duplicar",
  "editor.block.delete": "Eliminar",
  "editor.block.comment": "Comentar",
  "editor.block.convert": "Convertir en",
  "editor.block.color": "Color",
  "editor.block.moveUp": "Mover arriba",
  "editor.block.moveDown": "Mover abajo",
  "editor.block.copyLink": "Copiar enlace",
  "editor.block.copied": "Enlace copiado"
  ```
  ```json
  // messages/ar.json
  "editor.block.duplicate": "تكرار",
  "editor.block.delete": "حذف",
  "editor.block.comment": "تعليق",
  "editor.block.convert": "تحويل إلى",
  "editor.block.color": "اللون",
  "editor.block.moveUp": "نقل لأعلى",
  "editor.block.moveDown": "نقل لأسفل",
  "editor.block.copyLink": "نسخ الرابط",
  "editor.block.copied": "تم نسخ الرابط"
  ```
- [ ] Run → passes.
- [ ] Commit: `feat(editor): block right-click context menu (#271)`

---

## D8 — Outline drawer (not popover), nested H1–3 click-to-scroll matching version-history pattern (#55 / #234)

**Cause:** `outline-panel.tsx` renders a tiny `w-56` absolutely-positioned popover (`absolute end-0 top-0 ... w-56`) that is hard to use. Per the fix sketch, replace it with a full right-side drawer that matches `version-history.tsx`'s `fixed inset-y-0 right-0 z-30` panel, with nested H1/H2/H3 indentation and click-to-scroll. Keep `collectHeadings` + the `scrollIntoView` logic.

**Files:**
- Modify `src/components/editor/outline-panel.tsx`
- Create/extend `src/components/editor/outline-panel.test.tsx`
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:
- [ ] Write failing test `src/components/editor/outline-panel.test.tsx`: build an editor whose doc has H1 "Intro", H2 "Sub", H3 "Deep". Render `<OutlinePanel editor={editor} onClose={vi.fn()} />`. Assert the panel uses the drawer layout: the root element's className contains `fixed` and `inset-y-0` and `right-0` (NOT `w-56`/`absolute`). Assert all three headings render as buttons (`getByRole('button', { name: 'Intro' })` etc.) and that the H2/H3 carry increasing `padding-inline-start` (nesting). Assert clicking "Sub" calls `scrollIntoView` on the second `h1,h2,h3` (spy on `Element.prototype.scrollIntoView`). Assert a close button `getByLabelText` for `outline.hide` is present.
- [ ] Run `source ~/.zshenv && pnpm vitest run src/components/editor/outline-panel.test.tsx` → fails (still the popover layout).
- [ ] Rewrite `outline-panel.tsx`'s returned JSX to the drawer shell, copying `version-history.tsx:170-185` structure:
  ```tsx
  return (
    <div className="fixed inset-y-0 end-0 z-30 shadow-lg">
      <aside
        aria-label={t('outline.title')}
        className="bg-background flex h-full w-80 flex-col border-s"
      >
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-medium">{t('outline.title')}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('outline.hide')}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 text-sm">
          {headings.length === 0 ? (
            <p className="text-muted-foreground">{t('outline.empty')}</p>
          ) : (
            <ul className="space-y-0.5">
              {headings.map((h, i) => (
                <li key={h.id} style={{ paddingInlineStart: `${(h.level - 1) * 14}px` }}>
                  <button
                    type="button"
                    onClick={() => scrollToHeading(i)}
                    title={h.text}
                    className="block w-full truncate text-start text-muted-foreground hover:text-foreground"
                  >
                    {h.text || t('outline.untitled')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
  ```
  Import `{ X }` from `lucide-react`. Keep the existing `collectHeadings` state + `scrollToHeading` unchanged. The `(h.level - 1) * 14px` indentation gives the nested H1/H2/H3 appearance.
- [ ] Add i18n key (the `'Untitled'` literal becomes a string):
  ```json
  // messages/en.json
  "outline.untitled": "Untitled"
  ```
  ```json
  // messages/es.json
  "outline.untitled": "Sin título"
  ```
  ```json
  // messages/ar.json
  "outline.untitled": "بدون عنوان"
  ```
- [ ] Run → passes.
- [ ] Commit: `fix(editor): outline drawer with nested headings + click-to-scroll (#234)`

---

## D-GATE — Plan D verification gate (single PR onto `patches/v0.9.9`, HOLD for GO)

Run every check below; all must pass with zero deferral before opening the PR. GitHub-hosted runners only (no self-hosted). Biome must report 0 errors.

- [ ] `source ~/.zshenv && pnpm lint` → 0 errors (Biome v2; accept its import-sort/format auto-fixes).
- [ ] `source ~/.zshenv && pnpm typecheck` → clean (`tsc --noEmit`, TS6 strict).
- [ ] i18n parity check: every key added in D1/D3/D5/D6/D7/D8 exists in all three of `messages/en.json`, `messages/es.json`, `messages/ar.json` with no orphans and no NEW untranslated keys (the v0.9.0 P31 i18n Biome rule must report none-new). Confirm with: `source ~/.zshenv && cd /Users/jon/projects/cairn && node -e "const e=require('./messages/en.json'),s=require('./messages/es.json'),a=require('./messages/ar.json');const ke=Object.keys(e),ks=Object.keys(s),ka=Object.keys(a);const miss=ke.filter(k=>!ks.includes(k)||!ka.includes(k));if(miss.length){console.error('MISSING',miss);process.exit(1)}console.log('i18n parity OK',ke.length)"`.
- [ ] FULL test suite: `source ~/.zshenv && pnpm vitest run` (Docker/Colima up for Testcontainers; isolation stays ON) → all green, no skips introduced by Plan D.
- [ ] `source ~/.zshenv && pnpm build` → succeeds (`next build` + entrypoint tsc).
- [ ] **e2e UI-acceptance gate (editor group):** Playwright route-reachability smoke on the deployed image — open a page in the editor and verify per-feature deployed-image checks:
  - Page-action bar: hover Comments/History/Lock → tooltip text appears (D1).
  - Submit-for-review button renders as the primary (filled) variant (D2).
  - Lock the page → Suggest-edits + Bibliography controls stay visible-but-disabled (D3).
  - Type `**x**` and `~~y~~` → delimiters stripped, bold/strike applied; a blockquote/list shows no stray `"` glyphs (D4).
  - Select text → bubble toolbar shows color/highlight/H1–3/comment/align/sub-sup/inline-math; ⌘⇧M opens the comment composer (D5).
  - Hover a heading → collapse chevron appears; click hides the section, click again restores (D6).
  - Right-click a block → context menu with Duplicate/Delete/Comment/Convert/Color/Move/Copy-link; Copy-link writes to clipboard (D7).
  - Toggle Outline → full right-side drawer (not popover) with nested H1/H2/H3; click a heading scrolls to it (D8).
- [ ] Open ONE PR for Plan D onto `patches/v0.9.9` referencing #189 #190 #188 #260 #261 #262 #275 #276 #271 #234. **HOLD — do not merge; await user GO.**
