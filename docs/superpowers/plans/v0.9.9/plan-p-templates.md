# v0.9.9 Plan P — Templates

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Polish the Templates gallery (`/templates`) and the focus/reader-mode lifecycle. Three G10 findings: (P1) the built-in-only one-line `<details>` "Preview" becomes a real preview drawer that renders the template's actual blocks for any template — #68/#248; (P2) the two stacked card pills (`kind` chip + `Built-in` chip) collapse to a single icon-led kind indicator plus a subtle muted "Built-in" tag — #69/#250; (P3) focus/reader expand-state, which today persists in one global `localStorage` key across all navigation, resets when a fresh page is created (template **Use** instantiate, sidebar **+**, `…`→Add-child, top-bar **New page**) so a brand-new page never opens with the chrome hidden — #63/#247.

**Architecture:** Templates list at `src/app/(app)/templates/page.tsx` (server) → `src/components/templates/templates-gallery.tsx` (client). Preview pulls a sanitized block summary from a **new** `GET /api/templates/[id]` route (the file currently only exports `DELETE`); the summary is derived server-side from the stored `payload` jsonb (`TemplatePayloadSchema` — `pages[].content` is ProseMirror/TipTap doc JSON) so we never ship the full instantiable payload to the client. Focus/reader state lives in `src/components/pages/page-mode-shell.tsx` behind the per-device `localStorage` key `cairn:page-mode` (`PAGE_MODE_STORAGE_KEY`); the shell hydrates once on mount. The reset is a new exported `resetPageFocusMode()` helper that writes `focus:false` and dispatches a same-tab `storage`-style event the shell listens for, invoked from every new-page creation path.

**Tech Stack:** Next.js 16 App Router (React 19, TS6), Drizzle + Postgres, Biome v2, Vitest 4 + Testcontainers, TipTap 3, Tailwind v4 + shadcn/ui (Dialog — there is no Sheet/Drawer primitive; the Dialog is reused as the preview surface), i18n en/es/ar via `useT()`. No new migration in this plan (Templates is pure UI/route work; latest applied migration stays 0061). Prefix every shell command with `source ~/.zshenv && `.

---

## P1 — Template preview drawer with rendered blocks (#68/#248)

Today only built-ins with a hard-coded `BUILT_IN_DESCRIPTIONS[t.name]` entry get a one-line `<details>`/`<summary>` "Preview" (templates-gallery.tsx:160-171); workspace templates and any built-in not in the map get nothing. Replace it with a "Preview" button on every card that opens a Dialog rendering the template's actual block structure (headings, paragraphs, lists, callouts, database tables) as a read-only outline. The block summary is computed server-side from `payload` and exposed via a new `GET /api/templates/[id]`.

**Files:**
- Create: `src/lib/templates/preview.ts` (pure `buildTemplatePreview(payload): TemplatePreview`)
- Create: `tests/lib/templates/preview.test.ts`
- Modify: `src/app/api/templates/[id]/route.ts` (add `GET`)
- Create: `tests/api/templates/get.test.ts`
- Create: `src/components/templates/template-preview-dialog.tsx`
- Create: `tests/components/templates/template-preview-dialog.test.tsx`
- Modify: `src/components/templates/templates-gallery.tsx` (replace `<details>` with Preview button + dialog)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

### Steps

- [ ] Write failing test `tests/lib/templates/preview.test.ts`: `buildTemplatePreview` walks `payload.pages[].content` (ProseMirror doc JSON) into a flat ordered list of preview blocks. Assert a doc with `[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Agenda'}]},{type:'paragraph',content:[{type:'text',text:'Notes go here'}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'one'}]}]}]}]` yields `[{kind:'heading',level:2,text:'Agenda'},{kind:'paragraph',text:'Notes go here'},{kind:'list',text:'one'}]`. Assert a `database`-kind payload with one database named "Tasks" yields `[{kind:'database',text:'Tasks'}]`. Assert each page contributes a leading `{kind:'page',text:page.title}` header and that text is truncated to 140 chars. Assert empty/unknown nodes are skipped (no throw).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/templates/preview.test.ts`.
- [ ] Implement `src/lib/templates/preview.ts`. Parse with `TemplatePayloadSchema` from `./payload` (already exported). Type:
  ```ts
  export type PreviewBlock =
    | { kind: 'page'; text: string }
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'list'; text: string }
    | { kind: 'callout'; text: string }
    | { kind: 'database'; text: string };
  export type TemplatePreview = { name: string; kind: 'page' | 'database'; blocks: PreviewBlock[] };
  ```
  Walk via a recursive `collectText(node): string` that concatenates `node.text` over descendants. For each page push `{kind:'page',text:title}` then iterate top-level `content.content` mapping `heading`→`{kind:'heading',level:attrs.level??1,...}`, `paragraph`→paragraph (skip when empty), `bulletList`/`orderedList`/`taskList`→one `list` block per `listItem`/`taskItem`, `callout`→callout. For each database push `{kind:'database',text:db.name}`. Truncate every `text` with a local `clamp(s, 140)`. Cap total blocks at 60 (preview, not full render).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/templates/preview.test.ts`.
- [ ] Commit: `feat(templates): add buildTemplatePreview block summariser`.

- [ ] Write failing test `tests/api/templates/get.test.ts` (mirror `tests/api/templates/save-from-page.test.ts` setup: Testcontainers + `vi.mock('@/lib/auth/config')` with `__set`). Seed a built-in template (workspaceId null) and a workspace template. Assert `GET /api/templates/[builtinId]` as any member → 200 with `{ id, name, kind, blocks }`. Assert `GET` for a template in another workspace (not public, not built-in) → 404. Assert unauthenticated → 401.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/api/templates/get.test.ts`.
- [ ] Implement `GET` in `src/app/api/templates/[id]/route.ts`. Reuse the visibility gate already in `src/lib/templates/access.ts#canReadTemplate(db, { templateId, viewerUserId, viewerWorkspaceId })`. Sketch:
  ```ts
  export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    try {
      const ctx = await requireRole('viewer');
      const { id } = await params;
      const db = getDb();
      const ok = await canReadTemplate(db, { templateId: id, viewerUserId: ctx.userId, viewerWorkspaceId: ctx.workspaceId });
      if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const [tpl] = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
      if (!tpl) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const preview = buildTemplatePreview(tpl.payload);
      return NextResponse.json({ id: tpl.id, name: tpl.name, kind: preview.kind, blocks: preview.blocks });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
    }
  }
  ```
  Add imports for `canReadTemplate` and `buildTemplatePreview`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/templates/get.test.ts`.
- [ ] Commit: `feat(templates): add GET /api/templates/[id] preview route`.

- [ ] Add i18n keys. Append to `messages/en.json`:
  ```json
  "templates.preview.open": "Preview",
  "templates.preview.title": "{name}",
  "templates.preview.loading": "Loading preview…",
  "templates.preview.error": "Could not load this preview.",
  "templates.preview.empty": "This template has no content to preview.",
  "templates.preview.close": "Close",
  "templates.preview.kindPage": "Page template",
  "templates.preview.kindDatabase": "Database template"
  ```
  `messages/es.json`:
  ```json
  "templates.preview.open": "Vista previa",
  "templates.preview.title": "{name}",
  "templates.preview.loading": "Cargando vista previa…",
  "templates.preview.error": "No se pudo cargar esta vista previa.",
  "templates.preview.empty": "Esta plantilla no tiene contenido para previsualizar.",
  "templates.preview.close": "Cerrar",
  "templates.preview.kindPage": "Plantilla de página",
  "templates.preview.kindDatabase": "Plantilla de base de datos"
  ```
  `messages/ar.json`:
  ```json
  "templates.preview.open": "معاينة",
  "templates.preview.title": "{name}",
  "templates.preview.loading": "جارٍ تحميل المعاينة…",
  "templates.preview.error": "تعذّر تحميل هذه المعاينة.",
  "templates.preview.empty": "لا يحتوي هذا القالب على محتوى للمعاينة.",
  "templates.preview.close": "إغلاق",
  "templates.preview.kindPage": "قالب صفحة",
  "templates.preview.kindDatabase": "قالب قاعدة بيانات"
  ```
- [ ] Commit: `feat(i18n): add templates.preview keys (en/es/ar)`.

- [ ] Write failing test `tests/components/templates/template-preview-dialog.test.tsx` (Testing Library + jsdom; wrap render in `<I18nProvider locale="en" messages={en}>`). Mock `global.fetch` to resolve `{ id, name:'Meeting notes', kind:'page', blocks:[{kind:'heading',level:2,text:'Agenda'},{kind:'database',text:'Tasks'}] }`. Render `<TemplatePreviewDialog templateId="t1" name="Meeting notes" open onOpenChange={()=>{}} />`. Assert it calls `fetch('/api/templates/t1')`, shows the title "Meeting notes", and renders "Agenda" and "Tasks". Add a second test: fetch rejects → "Could not load this preview." appears.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/templates/template-preview-dialog.test.tsx`.
- [ ] Implement `src/components/templates/template-preview-dialog.tsx` ('use client'). Use shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` from `@/components/ui/dialog`, `useT()` from `@/lib/i18n/provider`. On `open` becoming true, `fetch('/api/templates/'+templateId)` once (guard against refetch with a ref keyed on templateId), set `{loading|error|blocks}`. Render each block by `kind`: `page`→`<p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">`, `heading`→`<p className="font-medium" style={{paddingLeft: (level-1)*0.75 + 'rem'}}>`, `paragraph`→muted `<p>`, `list`→`<p className="pl-3 before:content-['•'] before:mr-2">`, `callout`→bordered `<p className="rounded border-l-2 pl-2">`, `database`→`<p className="inline-flex items-center gap-1"><Database className="size-3"/>…</p>`. Scroll container `max-h-[60vh] overflow-y-auto`. Empty blocks → `t('templates.preview.empty')`. `DialogTitle` = `t('templates.preview.title', { name })`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/templates/template-preview-dialog.test.tsx`.
- [ ] Commit: `feat(templates): TemplatePreviewDialog renders block summary`.

- [ ] Modify `src/components/templates/templates-gallery.tsx`: delete `BUILT_IN_DESCRIPTIONS` (lines 25-29) and the `<details>` block (lines 160-171, plus the `ChevronRight` import on line 3). Add `const [previewId, setPreviewId] = useState<string | null>(null)` and `const t = useT()`. In each card's `CardContent`, before the action row, render a Preview button on **every** card:
  ```tsx
  <Button type="button" variant="ghost" size="sm" className="self-start px-1 text-muted-foreground" onClick={() => setPreviewId(t_.id)}>
    {t('templates.preview.open')}
  </Button>
  ```
  (rename the card item var to avoid shadowing the `t` translate fn — e.g. iterate `rows.map((tpl) => …)` and reference `tpl`). After the sections, mount one dialog: `{previewId ? <TemplatePreviewDialog templateId={previewId} name={templates.find(x=>x.id===previewId)?.name ?? ''} open onOpenChange={(o)=>{ if(!o) setPreviewId(null); }} /> : null}`. Keep the existing "Use template"/"Delete" buttons untouched.
- [ ] Run to pass + gallery regression: `source ~/.zshenv && pnpm vitest run tests/components/templates`.
- [ ] Commit: `feat(templates): replace one-line details with preview dialog (#68 #248)`.

---

## P2 — Card pill consolidation: kind icon + subtle Built-in (#69/#250)

Two stacked filled pills per card today (templates-gallery.tsx:138-151): a `bg-secondary` chip with icon + the raw `kind` word, and a `bg-primary` filled "Built-in" chip. The primary-filled Built-in pill is visually loud and competes with the kind chip. Consolidate to a single quiet row: an icon-led kind indicator (icon + Proper-cased label) and, when built-in, a muted text "Built-in" tag (no fill). The "In this workspace" chip stays as-is.

**Files:**
- Modify: `src/components/templates/templates-gallery.tsx`
- Create: `tests/components/templates/card-pills.test.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

### Steps

- [ ] Add i18n keys. `messages/en.json`:
  ```json
  "templates.kind.page": "Page",
  "templates.kind.database": "Database",
  "templates.builtIn": "Built-in",
  "templates.inThisWorkspace": "In this workspace"
  ```
  `messages/es.json`:
  ```json
  "templates.kind.page": "Página",
  "templates.kind.database": "Base de datos",
  "templates.builtIn": "Integrada",
  "templates.inThisWorkspace": "En este espacio de trabajo"
  ```
  `messages/ar.json`:
  ```json
  "templates.kind.page": "صفحة",
  "templates.kind.database": "قاعدة بيانات",
  "templates.builtIn": "مدمج",
  "templates.inThisWorkspace": "في مساحة العمل هذه"
  ```
- [ ] Commit: `feat(i18n): add templates kind/builtIn/inThisWorkspace keys (en/es/ar)`.

- [ ] Write failing test `tests/components/templates/card-pills.test.tsx` (render `<TemplatesGallery>` inside `<I18nProvider locale="en" messages={en}>` with `initialTemplates` containing one built-in page template and one workspace database template, `activeWorkspaceId` matching the workspace row). Assert: the kind label reads "Page"/"Database" (Proper-cased, not raw lowercase `page`/`database`). Assert the kind indicator carries an icon (`data-testid="tpl-kind-page"` / `"tpl-kind-database"`). Assert "Built-in" appears for the built-in row and has class `text-muted-foreground` and NOT `bg-primary` (query the element, assert `className` lacks `bg-primary`). Assert "In this workspace" still renders for the matching workspace row.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/templates/card-pills.test.tsx`.
- [ ] Implement in `src/components/templates/templates-gallery.tsx`. Replace the pill block (lines 138-156) with:
  ```tsx
  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
    <span
      data-testid={tpl.kind === 'database' ? 'tpl-kind-database' : 'tpl-kind-page'}
      className="inline-flex items-center gap-1 font-medium text-foreground"
    >
      {tpl.kind === 'database' ? (
        <Database aria-hidden className="size-3.5" />
      ) : (
        <FileText aria-hidden className="size-3.5" />
      )}
      {tpl.kind === 'database' ? t('templates.kind.database') : t('templates.kind.page')}
    </span>
    {tpl.builtIn ? <span className="text-muted-foreground">{t('templates.builtIn')}</span> : null}
    {activeWorkspaceId && tpl.workspaceId === activeWorkspaceId ? (
      <span className="text-muted-foreground">{t('templates.inThisWorkspace')}</span>
    ) : null}
  </div>
  ```
  (Built-in is now muted text, not a filled pill; kind is icon + Proper-case label.) Ensure `useT()` is in scope (added in P1; if P2 lands first, add `const t = useT()` and the `useT` import).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/templates/card-pills.test.tsx tests/components/templates`.
- [ ] Commit: `feat(templates): consolidate card pills to kind icon + muted Built-in (#69 #250)`.

---

## P3 — Expand-state reset on template Use / new-page creation (#63/#247)

`page-mode-shell.tsx` stores `{focus, reader}` in the single global `localStorage` key `cairn:page-mode` and hydrates once on mount (lines 116-118). So once a user enables focus/expand mode anywhere, every subsequently-opened page — including a freshly created one — mounts with chrome hidden and no obvious re-show affordance (this is the #247 / G2 #238 pain). Fix: on any **new-page creation** (template Use instantiate, sidebar **+** top-level, `…`→Add child, top-bar **New page**), clear the persisted focus flag and notify any live shell so the new page opens with chrome visible. Reader mode is intentionally preserved (it's a content-display preference, not a "where did my sidebar go" trap); only `focus` resets.

**Files:**
- Modify: `src/components/pages/page-mode-shell.tsx` (export `resetPageFocusMode()`, listen for reset + cross-tab events)
- Create: `tests/components/pages/page-mode-reset.test.tsx`
- Modify: `src/components/new-page-button.tsx`
- Modify: `src/components/sidebar/use-page-row-actions.tsx` (the `addChild` path)
- Modify: `src/components/templates/templates-gallery.tsx` (the `onUse` path)
- Create: `tests/components/templates/use-resets-focus.test.tsx`

### Steps

- [ ] Write failing test `tests/components/pages/page-mode-reset.test.tsx`: (1) seed `localStorage.setItem('cairn:page-mode', JSON.stringify({focus:true,reader:true}))`. Render `<PageModeShell><Probe/></PageModeShell>` where `Probe` calls `usePageMode()` and renders `focus:${focus} reader:${reader}`. After mount it reads `focus:true reader:true`. (2) Call the exported `resetPageFocusMode()` in `act()`; assert `localStorage` now holds `{focus:false,reader:true}` and the mounted shell re-renders to `focus:false reader:true` (reader preserved). (3) Assert `document.documentElement.classList.contains('cairn-focus-mode')` is false after reset.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/page-mode-reset.test.tsx`.
- [ ] Implement in `src/components/pages/page-mode-shell.tsx`. Add an exported event-name const and helper:
  ```ts
  /** Same-tab signal that focus mode must drop (e.g. a new page was just created). */
  export const PAGE_FOCUS_RESET_EVENT = 'cairn:page-focus-reset';

  /**
   * Clears the persisted focus flag (reader is intentionally preserved) and
   * notifies any mounted <PageModeShell> in this tab. Call from every new-page
   * creation path so a freshly created page never opens with chrome hidden
   * (#247). Safe to call from anywhere; no-ops on the server.
   */
  export function resetPageFocusMode(): void {
    if (typeof window === 'undefined') return;
    try {
      const prev = readPrefs();
      const next: PageMode = { focus: false, reader: prev.reader };
      writePrefs(next);
      window.dispatchEvent(new CustomEvent(PAGE_FOCUS_RESET_EVENT));
    } catch {
      // ignore — best effort
    }
  }
  ```
  In `PageModeShell`, add an effect subscribing to the same-tab event AND the cross-tab `storage` event so a reset in another tab also lands:
  ```ts
  useEffect(() => {
    function onReset() { setMode((prev) => ({ ...prev, focus: false })); }
    function onStorage(e: StorageEvent) { if (e.key === PAGE_MODE_STORAGE_KEY) setMode(readPrefs()); }
    window.addEventListener(PAGE_FOCUS_RESET_EVENT, onReset);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PAGE_FOCUS_RESET_EVENT, onReset);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  ```
  The existing `[mode.focus]` effect already toggles the `cairn-focus-mode` root class, so clearing `focus` removes the class for free.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/page-mode-reset.test.tsx`.
- [ ] Commit: `feat(pages): add resetPageFocusMode() + shell reset/storage listeners (#247)`.

- [ ] Wire `src/components/new-page-button.tsx`: import `resetPageFocusMode` from `@/components/pages/page-mode-shell` and call it in `onClick` immediately after a successful create, before `router.push`:
  ```ts
  const created = (await res.json()) as { id: string };
  resetPageFocusMode();
  router.push(`/pages/${created.id}` as Route);
  router.refresh();
  ```
- [ ] Wire `src/components/sidebar/use-page-row-actions.tsx` `addChild`: after `const { id } = (await res.json()) …` and before `router.push`, call `resetPageFocusMode()` (add the import).
- [ ] Wire `src/components/templates/templates-gallery.tsx` `onUse`: after parsing `data` and before navigating, call `resetPageFocusMode()` (add the import) so an instantiated template page opens with chrome visible:
  ```ts
  const data = (await res.json()) as InstantiateResponse;
  resetPageFocusMode();
  if (data.rootPageId) router.push(`/pages/${data.rootPageId}` as Route);
  else router.refresh();
  ```
- [ ] Write failing test `tests/components/templates/use-resets-focus.test.tsx`: seed `localStorage` `{focus:true,reader:false}`; mock `fetch` for `POST /api/templates/t1/instantiate` → `{ rootPageId:'p1', rootDatabaseId:null }` and mock `next/navigation`'s `useRouter` (`push`/`refresh` spies). Render `<TemplatesGallery>` (in `<I18nProvider>`), click "Use template" on the `t1` card, await microtasks. Assert `localStorage['cairn:page-mode']` parses to `focus:false` and `push` was called with `/pages/p1`.
- [ ] Run to fail then pass: `source ~/.zshenv && pnpm vitest run tests/components/templates/use-resets-focus.test.tsx`.
- [ ] Commit: `feat(templates,sidebar): reset focus mode on new-page + template Use (#63 #247)`.

---

## P-GATE — Group gate (single PR onto `patches/v0.9.9`, HOLD for GO)

GitHub-hosted runners only; Biome 0-errors; zero-deferral; full vitest; new e2e UI-acceptance gate. Run every command from the repo root with the `source ~/.zshenv && ` prefix.

- [ ] `source ~/.zshenv && pnpm lint` — **0 errors** (Biome v2; accept its import-sort/`import type` auto-fixes with `pnpm exec biome check --write` then re-run).
- [ ] `source ~/.zshenv && pnpm typecheck` — clean (`tsc --noEmit`); confirm `as Route` on all dynamic `/pages/${id}` hrefs.
- [ ] i18n none-new check: every key added in this plan exists in **all three** of `messages/en.json`, `messages/es.json`, `messages/ar.json` (`templates.preview.*`, `templates.kind.*`, `templates.builtIn`, `templates.inThisWorkspace`) and no `useT()` call references a key absent from `en.json`. Run the repo i18n parity check: `source ~/.zshenv && pnpm vitest run tests/lib/i18n`.
- [ ] FULL suite: `source ~/.zshenv && pnpm vitest run` — all green (Docker/Colima up for Testcontainers; `colima start` if the daemon is down).
- [ ] `source ~/.zshenv && pnpm build` — `next build` + entrypoint `tsc` succeed.
- [ ] **e2e UI-acceptance gate (route-reachability + per-feature deployed-image check)** against the built/deployed image, GitHub-hosted runner:
  - Route reachability: `GET /templates` 200 (authenticated smoke).
  - Per-feature deployed-image checklist:
    - P1: a template card shows a **Preview** button; clicking opens the dialog and renders the template's blocks (heading/paragraph/list/database names) — not the old one-line description; the dialog is dismissible.
    - P2: each card shows exactly one kind indicator (icon + "Page"/"Database"), built-ins show a **muted** "Built-in" tag (no filled primary pill); "In this workspace" still present for own-workspace rows.
    - P3: enable focus/expand mode on an existing page, then create a new page via the sidebar **+** (and separately via template **Use**) — the new page opens with the sidebar/topbar **visible** (focus reset); confirm reader mode, if it had been on, is preserved.
- [ ] Open a single PR onto `patches/v0.9.9` titled `feat(templates): preview drawer, pill consolidation, focus-reset (G10 #68/#248 #69/#250 #63/#247)`. **HOLD for user GO before merge.** Do not push from a subagent — the controller/human pushes and merges.
