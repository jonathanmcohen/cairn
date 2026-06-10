# Plan B — carry-forward from the v0.9.19 live-deploy sweep

> **HOLD until GO.**

Two seeded items; the re-audit corrected one of them to not-a-bug, so this plan
is **one fix + one correction record**.

## B1 — #76 slash leak via the modal **Cancel button** (REAL bug, root-caused)

**Live repro (confirmed against the v0.9.19 build):** type `/equation` → Enter
(opens Insert-equation modal) → click **Cancel** → editor still shows
`/equation`; typing `/` produces `/equation/` and **no slash menu ever opens**.

**Root cause (three interacting, individually-correct pieces):**

1. Deferred slash items (`deferred: true` — equation, footnote, citation,
   flashcard) take the deferred branch of `runSlashItem`
   (`slash-extension.ts:917-931`): `dismissSlashPopup` dispatches only the
   suggestion-exit meta (no doc edit, records `dismissedRange`), then the
   command opens the dialog **without deleting the `/equation` query text** —
   `consumeSlashRange` is deferred to the post-insert `.then()`.
2. Cancel → `settle(null)` (`editor-dialogs.tsx:156-180`) resolves the dialog
   promise with null → the command's `.then()` early-returns (equation
   `slash-extension.ts:660`) → `consumeSlashRange` **never runs**. The rAF
   focus restores the caret to the END of the preserved `/equation`.
3. The next `/` can never re-trigger: the slash Suggestion keeps
   @tiptap/suggestion's default `allowedPrefixes: [' ']`
   (`slash-extension.ts:950-951`), and for the trailing `/` of `/equation/`
   the preceding char is `n` → `findSuggestionMatch` returns null → no menu.

**Fix (single point):** when a deferred item's dialog resolves **null**
(cancel), delete the slash trigger range — i.e. run `consumeSlashRange(editor,
range)` in the cancel branch, not only after a successful insert — and clear
the plugin's `dismissedRange`. The user's pre-trigger text stays (the original
#76 guarantee); only the `/query` trigger is removed. Apply to all **five**
dialog-based deferred commands (equation `:660`, footnote `:174`, citation
`:201`, `/cite-doi` lookup `:257-298` — early return `:262` before its
`consumeSlashRange` at `:269` — and flashcard `:761`) or centralize in
`runSlashItem`'s deferred branch. The review also found the non-dialog
deferred pickers (image, file, pdf, audio, page embed, database) share the
cancel-never-consumes pattern — the centralized fix covers them; the per-command
fix must enumerate them too.

**Files:** `src/components/editor/slash-extension.ts` (primary);
`src/components/editor/editor-dialogs.tsx` only if cleanup is centralized in
`settle`. Spec: extend `tests/e2e/item-76-slash-cancel-preserves-text.spec.ts`.

**Coverage (why the v0.9.19 spec was false-green):** test 2 clicks the real
Cancel button but stops at asserting the modal closed + text preserved — it
never types `/` afterwards, so it never observes the wedged re-trigger. The
"preserved text" it asserts includes the `/equation` trigger itself, which is
exactly the wrong text to preserve.

**Failure modes verified:**

- Full sequence drives the REAL UI: `/equation` → Enter → click
  `getByRole('button', {name:'Cancel'})` → assert the trigger text is GONE
  from the paragraph → type `/` → assert a fresh slash menu opens. (RED on
  v0.9.19, GREEN after.)
- Escape path still preserves-and-recovers identically (existing test 1 stays
  green — no regression of the original #76 behavior for typed body text).
- Successful insert path unaffected: `/equation` → Enter → submit a formula →
  trigger text consumed, node inserted. (Node-insert is already asserted —
  `tests/components/editor/equation-slash.test.ts:35-56`,
  `tests/e2e/slash-ux.spec.ts:44-64` — but NO existing test asserts the
  trigger text was consumed on success; the B1 spec adds that assertion.)
- Repeat-cancel: cancel twice in a row, then `/` → menu still opens
  (dismissedRange cleared each time, no stale-range wedge).
- Cancel with text BEFORE the slash (`hello /equation` → cancel) → `hello `
  survives, only the trigger is removed.

## B2 — #117 correction record (docs only, no code)

The sweep's "heading collapse not in runtime DOM" premise was disproven by a
faithful browser repro (see README table): the chevron is a hover-gated gutter
overlay (`[data-heading-collapse-toggle]`, mounts on heading mousemove,
`heading-collapse.tsx:34-76,103`) and the collapse state is click-gated
ProseMirror decorations (`data-cairn-collapsed` + native `hidden`,
`heading-collapse-extension.ts:151,178-184`). All three requested fixes are
already true: children DO hide on click, the e2e DOES assert the toggle
attribute path, and no NodeView wrapper is needed (decorations are the
collab-safe design — a NodeView rewrite would regress the v0.9.18 #117 lesson).

**Deliverable:** this section, plus a "how to verify hover-gated editor UI"
note in `docs/operations.md` (static DOM greps cannot see hover-gated or
click-gated editor surfaces; verify by hover → `[data-heading-collapse-toggle]`
→ click → `[data-cairn-collapsed]`). Chevron *discoverability* (always-visible
affordance or a wider hover zone) → **E3, this release**.
