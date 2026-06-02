# v0.9.9 Plan N — Export & Publish

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Consolidate page export into a single coherent Export menu that covers MD / JSON / PDF / HTML / DOCX plus the subtree ZIP, kill the duplicate export entry points (the `PageExportMenu` in the action bar vs. the `Export as .md` / `Export subtree as .zip` buttons inside `page-menu.tsx`), add a discoverable `⌘⇧E` export shortcut surfaced in the `⋯` menu, and make the publish-to-web confirm modal show the resulting public URL *before* the user commits to Publish. Close GH issues #56, #235 (one Export menu + HTML/DOCX), #61, #240 (export shortcut + hints), #70, #249 (publish URL preview), with new server-side HTML and DOCX export pipelines added behind the existing `/api/pages/[pageId]/export?format=…` route.

**Architecture:** The export route (`src/app/api/pages/[pageId]/export/route.ts`) stays the single source of truth for export bytes — every menu item is a plain `<a download href="…?format=…">`, so no client serialization is duplicated. We add two new server renderers: `format=html` returns a standalone, themed HTML document (reusing `pageToMarkdown` → `marked`, sharing the print stylesheet with `pageToPdfHtml` but without the auto-`window.print()` script), and `format=docx` returns an `application/vnd.openxmlformats-officedocument.wordprocessingml.document` byte stream built with the `docx` JS library from the same ProseMirror walk. The duplicated MD/ZIP buttons are removed from `page-menu.tsx`; `PageExportMenu` (in the action bar via `page-action-panels.tsx`) becomes the lone export surface and grows HTML/DOCX/ZIP items. `⌘⇧E` is registered as a `global` shortcut that programmatically opens that menu (or triggers the MD download as a no-menu fallback), and the `⋯` page-menu gains a muted "Export… (⌘⇧E)" hint row that focuses/opens the action-bar export menu. Publish gets a new `GET /api/pages/[pageId]/publish` preview endpoint returning the slug+URL the page *would* receive, so the confirm modal renders the real public link before POST.

**Tech Stack:** Next.js 16 App Router (route handlers, `runtime = 'nodejs'`), React 19 client components, TypeScript 6 strict, Drizzle + Postgres, Biome v2 (0 errors), Vitest 4 + Testcontainers (real Postgres for route/lib tests, jsdom for component tests), `radix-ui` DropdownMenu, `marked` (already a dep) for HTML, **`docx` v9** (new dep) for DOCX, i18n via `useT()` with en/es/ar keys in `messages/*.json`, shortcuts via `src/lib/shortcuts/registry.ts` + `src/components/shortcuts/`.

**DOCX library decision (#56):** Two candidates — (a) a server-side **pandoc** binary invoked via child-process, or (b) the pure-JS **`docx`** npm package. We pick **`docx`** (option b). Rationale baked into the constraints: the CI/release pipeline runs on **GitHub-hosted runners only** and the deployed image is a single Node container — adding a `pandoc` (or LibreOffice/`unoconv`) binary means a Dockerfile `apt-get` layer + a runtime dependency that the GitHub-hosted runner's test job cannot exercise without installing system packages, and it bloats the image. `docx` is a dependency-light pure-JS builder that emits a valid `.docx` Buffer in-process, runs identically in tests and prod, and consumes the same ProseMirror JSON walk we already use for Markdown. Tradeoff: `docx` gives us *less* fidelity than pandoc for exotic blocks (no automatic table-of-contents field, KaTeX math is flattened to its source text, code-block syntax highlighting is dropped to monospace) — acceptable for a "good-enough Word handoff" export, and documented in the renderer JSDoc. HTML export needs no new dep (`marked` already ships).

---

## N1 — Consolidate export into a single menu (MD / JSON / PDF / HTML / DOCX + ZIP) and dedupe `page-menu.tsx` (#56, #235)

Cause (from scope #235 / #187): export is scattered across two surfaces. `page-action-panels.tsx` mounts `PageExportMenu` (a radix DropdownMenu with MD/JSON/PDF), while `page-menu.tsx` (the `⋯` menu) *separately* renders its own `Export as .md` and `Export subtree as .zip` buttons that hit the same route with raw `download()` anchors. Two menus, three terms, missing HTML/DOCX. Fix: make `PageExportMenu` the single grouped menu (Document: MD/PDF/HTML/DOCX · Data: JSON · Subtree: ZIP), and delete the export buttons from `page-menu.tsx`.

**Files:**
- Modify: `src/components/pages/export-menu.tsx` (add JSON already present; add HTML, DOCX, ZIP items; group with `DropdownMenu.Label` + `DropdownMenu.Separator`)
- Modify: `src/components/page-menu.tsx` (remove the `Export as .md` + `Export subtree as .zip` buttons and their now-unused `Download`/`FileStack` imports + `download()` helper if otherwise unused)
- Modify: `tests/components/pages/export-menu.test.tsx` (assert all six items + correct hrefs)
- Modify: `tests/components/page-action-panels.test.tsx` (unchanged behavior — export still mounts)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` (new export group/label keys)

Steps:
- [ ] Add the new i18n keys to all three message files (HTML, DOCX, subtree-ZIP item labels + two group labels). Append after the existing `pageActions.export.pdf` block.
  ```json
  // messages/en.json
  "pageActions.export.html": "HTML (.html)",
  "pageActions.export.docx": "Word (.docx)",
  "pageActions.export.zip": "Subtree (.zip)",
  "pageActions.export.groupDocument": "Document",
  "pageActions.export.groupData": "Data",
  "pageActions.export.groupSubtree": "Subtree",
  ```
  ```json
  // messages/es.json
  "pageActions.export.html": "HTML (.html)",
  "pageActions.export.docx": "Word (.docx)",
  "pageActions.export.zip": "Subárbol (.zip)",
  "pageActions.export.groupDocument": "Documento",
  "pageActions.export.groupData": "Datos",
  "pageActions.export.groupSubtree": "Subárbol",
  ```
  ```json
  // messages/ar.json
  "pageActions.export.html": "HTML (.html)",
  "pageActions.export.docx": "Word (.docx)",
  "pageActions.export.zip": "الشجرة الفرعية (.zip)",
  "pageActions.export.groupDocument": "مستند",
  "pageActions.export.groupData": "بيانات",
  "pageActions.export.groupSubtree": "شجرة فرعية",
  ```
- [ ] Write a failing test in `tests/components/pages/export-menu.test.tsx` asserting the menu renders six download links with the right hrefs once opened:
  ```tsx
  it('renders all six export targets with correct hrefs (#56/#235)', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <PageExportMenu pageId="p1" open onOpenChange={() => {}} />
      </I18nProvider>,
    );
    const link = (name: string) => screen.getByRole('menuitem', { name }) as HTMLAnchorElement;
    expect(link(en['pageActions.export.markdown']).getAttribute('href')).toBe('/api/pages/p1/export?format=md');
    expect(link(en['pageActions.export.pdf']).getAttribute('href')).toBe('/api/pages/p1/export?format=pdf');
    expect(link(en['pageActions.export.html']).getAttribute('href')).toBe('/api/pages/p1/export?format=html');
    expect(link(en['pageActions.export.docx']).getAttribute('href')).toBe('/api/pages/p1/export?format=docx');
    expect(link(en['pageActions.export.json']).getAttribute('href')).toBe('/api/pages/p1/export?format=json');
    expect(link(en['pageActions.export.zip']).getAttribute('href')).toBe('/api/pages/p1/export?recursive=true');
  });
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/pages/export-menu.test.tsx` — confirm it FAILS (html/docx/zip items missing).
- [ ] Implement: in `src/components/pages/export-menu.tsx` add `FileImage`/`FileType`/`Files` Lucide icons (use `FileType` for DOCX, `FileCode` already used for PDF — keep `Globe`/`FileCode2` for HTML, `Files` for ZIP), wrap items in three `DropdownMenu.Group` blocks separated by `DropdownMenu.Separator`, each preceded by a `DropdownMenu.Label`. Add the new anchors. Use `href('html')`, `href('docx')`, and a `hrefZip = \`/api/pages/${pageId}/export?recursive=true\`` for the subtree. Example for the added items:
  ```tsx
  <DropdownMenu.Label className="px-2 py-1 text-muted-foreground text-xs">
    {t('pageActions.export.groupDocument')}
  </DropdownMenu.Label>
  {/* md, pdf … then: */}
  <DropdownMenu.Item asChild>
    <a href={href('html')} download className={itemCls}>
      <FileCode2 aria-hidden="true" className="h-4 w-4" />
      {t('pageActions.export.html')}
    </a>
  </DropdownMenu.Item>
  <DropdownMenu.Item asChild>
    <a href={href('docx')} download className={itemCls}>
      <FileType aria-hidden="true" className="h-4 w-4" />
      {t('pageActions.export.docx')}
    </a>
  </DropdownMenu.Item>
  <DropdownMenu.Separator className="my-1 h-px bg-border" />
  <DropdownMenu.Label className="px-2 py-1 text-muted-foreground text-xs">
    {t('pageActions.export.groupData')}
  </DropdownMenu.Label>
  {/* json item … */}
  <DropdownMenu.Separator className="my-1 h-px bg-border" />
  <DropdownMenu.Label className="px-2 py-1 text-muted-foreground text-xs">
    {t('pageActions.export.groupSubtree')}
  </DropdownMenu.Label>
  <DropdownMenu.Item asChild>
    <a href={`/api/pages/${pageId}/export?recursive=true`} download className={itemCls}>
      <Files aria-hidden="true" className="h-4 w-4" />
      {t('pageActions.export.zip')}
    </a>
  </DropdownMenu.Item>
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/pages/export-menu.test.tsx` — confirm it PASSES.
- [ ] Remove the duplicated export buttons from `src/components/page-menu.tsx`: delete the two `<button>` blocks rendering `t('pageMenu.exportMd')` and `t('pageMenu.exportZip')` (lines ~220-241), the `Download` + `FileStack` imports, and the `download()` helper if no other caller uses it (it is still referenced nowhere else after removal — verify and delete). Leave a comment pointing to the action-bar Export menu as the single surface.
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/page-menu-publish-confirm.test.tsx` — confirm it still PASSES (the publish-confirm flow is untouched by the export removal).
- [ ] Commit: `refactor(export): single grouped Export menu (MD/JSON/PDF/HTML/DOCX/ZIP), drop dup page-menu export buttons (#56 #235)`

---

## N2 — `⌘⇧E` export shortcut + surface shortcut hints in the `⋯` menu (#61, #240)

Cause (from scope #240): there is no export shortcut, and the `⋯` menu shows no keyboard hints. The shortcut registry (`src/lib/shortcuts/registry.ts` + `app-shortcuts.ts`) already drives the `⌘/` sheet and the global dispatcher; `Mod+Shift+E` is unused in the `global` scope (existing: `Mod+N`, `Mod+Shift+L/O/F/N`, `Mod+/`). Fix: register `Mod+Shift+E` that fires a `cairn:export:open` window event; `PageExportMenu` listens and opens itself (and the action-bar controller routes its open-state through the single-open-panel controller). Add a muted "Export… (⌘⇧E)" hint row to the `⋯` menu.

**Files:**
- Modify: `src/components/shortcuts/app-shortcuts.ts` (register `export.page` global shortcut + add `export: () => void` to `ShortcutHandlers`)
- Modify: `src/components/shortcuts/dispatcher.tsx` (implement the `export` handler → `window.dispatchEvent(new CustomEvent('cairn:export:open'))`, pass into `setShortcutHandlers`)
- Modify: `src/components/pages/export-menu.tsx` (listen for `cairn:export:open`, open the menu)
- Modify: `src/components/page-menu.tsx` (add a disabled-look hint row "Export… ⌘⇧E" that dispatches the same event)
- Create: `tests/lib/shortcuts/export-shortcut.test.ts`
- Modify: `tests/components/pages/export-menu.test.tsx` (event-opens-menu test)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` (`shortcut.export`, `pageMenu.exportHint`)

Steps:
- [ ] Add i18n keys to all three files:
  ```json
  // messages/en.json
  "shortcut.export": "Export page",
  "pageMenu.exportHint": "Export…",
  ```
  ```json
  // messages/es.json
  "shortcut.export": "Exportar página",
  "pageMenu.exportHint": "Exportar…",
  ```
  ```json
  // messages/ar.json
  "shortcut.export": "تصدير الصفحة",
  "pageMenu.exportHint": "تصدير…",
  ```
- [ ] Write a failing test `tests/lib/shortcuts/export-shortcut.test.ts` proving the shortcut is registered without collision and matches `Mod+Shift+E`:
  ```ts
  import { afterEach, expect, it } from 'vitest';
  import { ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
  import { matchShortcut, resetRegistry } from '@/lib/shortcuts/registry';

  afterEach(() => resetRegistry());

  it('registers Mod+Shift+E → export.page in global scope (#61/#240)', () => {
    ensureAppShortcuts();
    const hit = matchShortcut(
      { key: 'e', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
      'global',
    );
    expect(hit?.id).toBe('export.page');
    expect(hit?.labelKey).toBe('shortcut.export');
  });
  ```
  Note: `ensureAppShortcuts` memoizes via the module-level `registered` flag — the test imports a fresh module per file (Vitest isolation ON), and `resetRegistry()` clears entries; if `registered` blocks re-run within a file, export a test-only `__resetRegistered()` or rely on single-call-per-file. Use one `it` per file to stay safe, or add `export function __resetRegistered() { registered = false; }` to `app-shortcuts.ts` and call it in `afterEach`.
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/shortcuts/export-shortcut.test.ts` — confirm it FAILS (no such shortcut).
- [ ] Implement in `src/components/shortcuts/app-shortcuts.ts`: add `export: () => void;` to `ShortcutHandlers`, and register inside `ensureAppShortcuts()`:
  ```ts
  registerShortcut({
    id: 'export.page',
    keys: 'Mod+Shift+E',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.export',
    run: () => {
      handlers?.export();
    },
  });
  ```
- [ ] Implement in `src/components/shortcuts/dispatcher.tsx`: add `const openExport = useCallback(() => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cairn:export:open')); }, []);` and include `export: openExport` in the `setShortcutHandlers({…})` call + the effect dependency array.
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/shortcuts/export-shortcut.test.ts` — confirm it PASSES.
- [ ] Write a failing component test in `tests/components/pages/export-menu.test.tsx`: dispatch `cairn:export:open` and assert the menu opens (an item becomes visible). Because radix open-state is internal when uncontrolled, drive it through the controlled `open`/`onOpenChange` instead — render with a parent that toggles `open` on the event:
  ```tsx
  it('opens when cairn:export:open fires (#61/#240)', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        const h = () => setOpen(true);
        window.addEventListener('cairn:export:open', h);
        return () => window.removeEventListener('cairn:export:open', h);
      }, []);
      return <PageExportMenu pageId="p1" open={open} onOpenChange={setOpen} />;
    }
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <Harness />
      </I18nProvider>,
    );
    expect(screen.queryByRole('menuitem', { name: en['pageActions.export.markdown'] })).toBeNull();
    act(() => window.dispatchEvent(new CustomEvent('cairn:export:open')));
    expect(await screen.findByRole('menuitem', { name: en['pageActions.export.markdown'] })).toBeTruthy();
  });
  ```
- [ ] Run that test — confirm it FAILS, then add the event listener to `PageExportMenu` (so it self-opens even standalone, and the action-bar controller's `onOpenChange` keeps single-open mutual exclusion):
  ```tsx
  useEffect(() => {
    const onOpen = () => onOpenChange?.(true);
    window.addEventListener('cairn:export:open', onOpen);
    return () => window.removeEventListener('cairn:export:open', onOpen);
  }, [onOpenChange]);
  ```
  For the standalone/self-managed case (no `onOpenChange` prop), keep a local `selfOpen` state fallback so the listener still works; route radix `open` from `open ?? selfOpen`.
- [ ] Run the component test — confirm it PASSES.
- [ ] Add the `⋯`-menu hint row in `src/components/page-menu.tsx` (just below the divider where the old export buttons were), dispatching the same event so the hint actually opens the action-bar menu:
  ```tsx
  <button
    type="button"
    className={ITEM_CLASS}
    onClick={() => {
      window.dispatchEvent(new CustomEvent('cairn:export:open'));
      setOpen(false);
    }}
  >
    <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
    <span className="flex-1">{t('pageMenu.exportHint')}</span>
    <kbd className="ml-auto text-muted-foreground text-xs">⌘⇧E</kbd>
  </button>
  ```
  (Re-add the `Download` import removed in N1 — it is used again here.)
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/page-menu-publish-confirm.test.tsx tests/components/pages/export-menu.test.tsx` — confirm both PASS.
- [ ] Commit: `feat(export): ⌘⇧E export shortcut + ⋯-menu hint that opens the Export menu (#61 #240)`

---

## N3 — Publish-to-web modal pre-shows the resulting public URL before Publish (#70, #249)

Cause (from scope #249): the publish confirm dialog (`page-menu.tsx`, `confirmPublishOpen`) shows only generic body copy ("Anyone with the link can view this page. Continue?") and never the URL — the slug is minted server-side on POST. Fix: add a `GET /api/pages/[pageId]/publish` preview endpoint that returns the slug+url the page *would* get (deterministic: reuse `page.publicSlug` if already minted, otherwise compute a stable preview `slugify(title)` base so the user sees the path shape), and render `${origin}/p/${slug}` inside the confirm dialog before they hit Publish.

**Files:**
- Modify: `src/lib/pages/publish.ts` (add pure `previewPublicSlug(page)` helper — returns existing slug or `slugify(title)` base, no random suffix, no mutation)
- Modify: `src/app/api/pages/[pageId]/publish/route.ts` (add `GET` handler returning `{ slug, url, minted }`)
- Modify: `src/components/page-menu.tsx` (fetch preview when the confirm dialog opens; render the URL row + a copy button)
- Create: `tests/lib/pages/publish-preview.test.ts`
- Modify: `tests/api/pages-publish.test.ts` (GET preview returns predicted slug, does not mutate)
- Modify: `tests/components/page-menu-publish-confirm.test.tsx` (dialog shows the URL before confirm)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` (`publishConfirm.urlLabel`, `publishConfirm.copyUrl`, `publishConfirm.urlCopied`)

Steps:
- [ ] Add i18n keys to all three files:
  ```json
  // messages/en.json
  "publishConfirm.urlLabel": "Public URL",
  "publishConfirm.copyUrl": "Copy URL",
  "publishConfirm.urlCopied": "Copied!",
  ```
  ```json
  // messages/es.json
  "publishConfirm.urlLabel": "URL pública",
  "publishConfirm.copyUrl": "Copiar URL",
  "publishConfirm.urlCopied": "¡Copiado!",
  ```
  ```json
  // messages/ar.json
  "publishConfirm.urlLabel": "الرابط العام",
  "publishConfirm.copyUrl": "نسخ الرابط",
  "publishConfirm.urlCopied": "تم النسخ!",
  ```
- [ ] Write a failing unit test `tests/lib/pages/publish-preview.test.ts` for the pure helper:
  ```ts
  import { expect, it } from 'vitest';
  import { previewPublicSlug } from '@/lib/pages/publish';

  it('reuses an existing slug when present (#70/#249)', () => {
    expect(previewPublicSlug({ title: 'Whatever', publicSlug: 'docs-abc123' })).toBe('docs-abc123');
  });
  it('previews a stable slug base from the title when never published', () => {
    expect(previewPublicSlug({ title: 'My Launch Plan!', publicSlug: null })).toBe('my-launch-plan');
  });
  it('falls back to "page" for an empty title', () => {
    expect(previewPublicSlug({ title: '', publicSlug: null })).toBe('page');
  });
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/pages/publish-preview.test.ts` — confirm it FAILS.
- [ ] Implement `previewPublicSlug` in `src/lib/pages/publish.ts` (pure, reuses the existing `slugify`):
  ```ts
  /**
   * Non-mutating preview of the public slug a page would receive. Reuses the
   * already-minted slug if present; otherwise returns the deterministic
   * `slugify(title)` base WITHOUT the random suffix — enough to show the user
   * the path shape in the publish-confirm dialog (#70/#249). The real random
   * suffix is appended only on the actual POST publish.
   */
  export function previewPublicSlug(page: { title: string; publicSlug: string | null }): string {
    return page.publicSlug ?? slugify(page.title);
  }
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/pages/publish-preview.test.ts` — confirm it PASSES.
- [ ] Write a failing route test in `tests/api/pages-publish.test.ts` (Testcontainers Postgres; follow the existing `vi.mock('@/lib/auth/config')` + `__set` pattern already used in that file) asserting `GET` returns the predicted slug+url and does NOT set `published=true`:
  ```ts
  it('GET preview returns predicted url without publishing (#70/#249)', async () => {
    const { GET } = await import('@/app/api/pages/[pageId]/publish/route');
    const res = await GET(new Request('http://t/'), { params: Promise.resolve({ pageId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string; url: string; minted: boolean };
    expect(body.url).toBe(`/p/${body.slug}`);
    expect(body.minted).toBe(false);
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    expect(row.published).toBe(false);
    expect(row.publicSlug).toBeNull();
  });
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/api/pages-publish.test.ts` — confirm the new case FAILS (no GET handler).
- [ ] Implement the `GET` handler in `src/app/api/pages/[pageId]/publish/route.ts` (viewer-gated read, loads the page via the access helper, no mutation):
  ```ts
  export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
    try {
      const { pageId } = await params;
      const { page } = await requirePageAccess(pageId, 'viewer');
      const slug = previewPublicSlug({ title: page.title ?? '', publicSlug: page.publicSlug });
      return NextResponse.json({ slug, url: `/p/${slug}`, minted: page.publicSlug != null });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'unknown' },
        { status: 500 },
      );
    }
  }
  ```
  (Add `import { previewPublicSlug } from '@/lib/pages/publish';` and `requirePageAccess`.)
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/api/pages-publish.test.ts` — confirm it PASSES.
- [ ] Write a failing component test in `tests/components/page-menu-publish-confirm.test.tsx` asserting the dialog shows the URL fetched from the preview endpoint before confirm. Stub `fetch` so `GET /api/pages/p1/publish` resolves `{ slug: 's1', url: '/p/s1', minted: false }`:
  ```ts
  it('shows the public URL preview before publishing (#70/#249)', async () => {
    fetchSpy.mockImplementation((input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/api/pages/p1/publish')) {
        return Promise.resolve(new Response(JSON.stringify({ slug: 's1', url: '/p/s1', minted: false }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    expect(await screen.findByText('/p/s1')).toBeTruthy();
    expect(screen.getByText(en['publishConfirm.urlLabel'])).toBeTruthy();
  });
  ```
  (Note: the existing tests stub `fetch` to a fixed `{slug:'s1'}` response — keep those green; the new test installs a path-aware implementation. Ensure the `GET` is fired with `{ method: 'GET' }` or default, distinct from the `POST` publish.)
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/page-menu-publish-confirm.test.tsx` — confirm the new case FAILS.
- [ ] Implement in `src/components/page-menu.tsx`: add `const [previewUrl, setPreviewUrl] = useState<string | null>(null);` and a `previewCopied` flag. When `confirmPublishOpen` becomes true, fetch the preview:
  ```tsx
  useEffect(() => {
    if (!confirmPublishOpen) return;
    let cancelled = false;
    void fetch(`/api/pages/${pageId}/publish`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { url: string } | null) => {
        if (!cancelled && b) setPreviewUrl(`${window.location.origin}${b.url}`);
      });
    return () => {
      cancelled = true;
    };
  }, [confirmPublishOpen, pageId]);
  ```
  Render inside the `<DialogContent>` between the description and footer:
  ```tsx
  {previewUrl && (
    <div className="rounded-md border bg-muted/40 p-2">
      <div className="text-muted-foreground text-xs">{t('publishConfirm.urlLabel')}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate text-sm">{previewUrl}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(previewUrl).then(() => {
              setPreviewCopied(true);
              setTimeout(() => setPreviewCopied(false), 1500);
            });
          }}
        >
          {previewCopied ? t('publishConfirm.urlCopied') : t('publishConfirm.copyUrl')}
        </Button>
      </div>
    </div>
  )}
  ```
  Reset `previewUrl` to `null` when the dialog closes (in the `onOpenChange` of the publish `Dialog`).
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/page-menu-publish-confirm.test.tsx` — confirm ALL cases PASS (existing publish-on-confirm + the new URL-preview).
- [ ] Commit: `feat(publish): show resulting public URL preview in confirm modal via GET publish endpoint (#70 #249)`

---

## N4 — Ship HTML + DOCX export via a server pipeline (#56)

Cause (from scope #56/#235): the export route only emits MD/JSON/PDF-HTML; no real HTML document and no Word output. Fix: add server renderers `pageToHtml(page)` (standalone themed HTML, no auto-print) and `pageToDocx(page)` (a `Buffer` via the `docx` JS lib), wire both into `format=html` / `format=docx` branches of the export route. See the **DOCX library decision** in the header for why `docx` (not pandoc).

**Files:**
- Modify: `package.json` (add `"docx": "^9.5.1"` to dependencies)
- Create: `src/lib/export/html.ts` (`pageToHtml(page): string`)
- Create: `src/lib/export/docx.ts` (`pageToDocx(page): Promise<Buffer>`)
- Modify: `src/app/api/pages/[pageId]/export/route.ts` (add `format=html` and `format=docx` branches)
- Create: `tests/lib/export/html.test.ts`
- Create: `tests/lib/export/docx.test.ts`
- Modify: `tests/api/` page-export route test (add html/docx content-type + disposition assertions) — create `tests/api/pages-export-formats.test.ts` if no existing route test covers this path.

Steps:
- [ ] Add `docx` to `package.json` dependencies and install: `source ~/.zshenv && pnpm add docx@^9.5.1`. Confirm `docx` is pure-JS (no native build) and therefore needs no `allowBuilds` entry in `pnpm-workspace.yaml` (verify install runs no postinstall build script; if pnpm 11 stubs an entry, set it `false`).
- [ ] Write a failing test `tests/lib/export/html.test.ts`:
  ```ts
  import { expect, it } from 'vitest';
  import { pageToHtml } from '@/lib/export/html';

  const page = {
    id: 'p1',
    title: 'Hello <World>',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body line' }] }] },
  };

  it('emits a standalone HTML doc with escaped title and body, no auto-print script (#56)', () => {
    const html = pageToHtml(page);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Hello &lt;World&gt;');
    expect(html).toContain('Body line');
    expect(html).not.toContain('window.print()');
  });
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/export/html.test.ts` — confirm it FAILS.
- [ ] Implement `src/lib/export/html.ts` — reuse `pageToMarkdown` + `marked`, share the print stylesheet from `pdf.ts` but DROP the auto-print `<script>`:
  ```ts
  import { marked } from 'marked';
  import { pageToMarkdown } from './renderers';

  // biome-ignore lint/suspicious/noExplicitAny: page shape mirrors export renderers
  type ExportPage = { id: string; title: string; content: any };

  const HTML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' };

  /**
   * Standalone, themed HTML export (#56). Same block coverage as Markdown
   * (`pageToMarkdown` → `marked`) and the same print-friendly stylesheet as the
   * PDF-print path, but WITHOUT the auto-`window.print()` script — this is a
   * file the user keeps/serves, not a print trigger.
   */
  export function pageToHtml(page: ExportPage): string {
    const bodyHtml = marked.parse(pageToMarkdown(page), { async: false }) as string;
    const safeTitle = page.title.replace(/[<>&"]/g, (c) => HTML_ESCAPES[c] ?? c);
    return `<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
    pre { background: #f6f6f6; padding: 0.8em; border-radius: 4px; overflow: auto; }
    code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.92em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #ddd; padding-left: 1em; color: #555; margin-left: 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; }
    img { max-width: 100%; }
    ul, ol { padding-left: 1.4em; }
  </style>
  </head>
  <body>
  <h1>${safeTitle}</h1>
  ${bodyHtml}
  </body>
  </html>`;
  }
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/export/html.test.ts` — confirm it PASSES.
- [ ] Write a failing test `tests/lib/export/docx.test.ts` (assert it returns a real OOXML Buffer — `.docx` is a ZIP whose first bytes are `PK\x03\x04`):
  ```ts
  import { expect, it } from 'vitest';
  import { pageToDocx } from '@/lib/export/docx';

  const page = {
    id: 'p1',
    title: 'Doc Title',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello body' }] },
      ],
    },
  };

  it('produces a valid OOXML (.docx) buffer with a PK zip header (#56)', async () => {
    const buf = await pageToDocx(page);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/export/docx.test.ts` — confirm it FAILS.
- [ ] Implement `src/lib/export/docx.ts` — walk the same Markdown the other exporters produce and map line-by-line to `docx` `Paragraph`s (headings via `HeadingLevel`, fenced code to monospace paragraphs, everything else to body text). Keep it deliberately simple per the tradeoff note (math/code-highlighting flattened):
  ```ts
  import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
  import { pageToMarkdown } from './renderers';

  // biome-ignore lint/suspicious/noExplicitAny: page shape mirrors export renderers
  type ExportPage = { id: string; title: string; content: any };

  const HEADING = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ] as const;

  /**
   * Word (.docx) export (#56). Pure-JS via the `docx` package — no pandoc/
   * Chromium binary, so it runs identically on GitHub-hosted CI and in the
   * single-container deploy. Maps the page's Markdown line-by-line to
   * paragraphs. Deliberately lossy vs. pandoc: inline math is flattened to its
   * LaTeX source and code blocks render as monospace paragraphs without syntax
   * highlighting (documented tradeoff in v0.9.9-plan-n-export-publish.md).
   */
  export async function pageToDocx(page: ExportPage): Promise<Buffer> {
    const md = pageToMarkdown(page);
    const lines = md.split('\n');
    const children: Paragraph[] = [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(page.title)] }),
    ];
    let inFence = false;
    for (const line of lines) {
      if (line.startsWith('```')) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })] }));
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        children.push(new Paragraph({ heading: HEADING[h[1].length - 1], children: [new TextRun(h[2])] }));
        continue;
      }
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
  }
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/lib/export/docx.test.ts` — confirm it PASSES.
- [ ] Write a failing route test in `tests/api/pages-export-formats.test.ts` (Testcontainers; reuse the existing export route test's auth-mock + seed helpers; create one page, request each format):
  ```ts
  it('format=html returns themed HTML with attachment disposition (#56)', async () => {
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request('http://t/?format=html'), { params: Promise.resolve({ pageId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-disposition')).toContain('.html');
    expect(await res.text()).toContain('<!doctype html>');
  });

  it('format=docx returns an OOXML attachment (#56)', async () => {
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request('http://t/?format=docx'), { params: Promise.resolve({ pageId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toContain('.docx');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
  ```
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/api/pages-export-formats.test.ts` — confirm both FAIL.
- [ ] Implement the two branches in `src/app/api/pages/[pageId]/export/route.ts`, placed before the markdown default and after the `pdf` branch:
  ```ts
  if (format === 'html') {
    return new NextResponse(pageToHtml(page), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="${safeName}.html"`,
      },
    });
  }

  if (format === 'docx') {
    const buf = await pageToDocx(page);
    // @ts-expect-error: Node Buffer → web Response works at runtime in Next 16
    return new NextResponse(buf, {
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${safeName}.docx"`,
      },
    });
  }
  ```
  Add imports: `import { pageToHtml } from '@/lib/export/html';` and `import { pageToDocx } from '@/lib/export/docx';`.
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/api/pages-export-formats.test.ts` — confirm both PASS.
- [ ] Commit: `feat(export): server HTML + DOCX export via marked + docx pipeline (#56)`

---

## N5 — Group gate (HOLD for GO)

Single PR onto `patches/v0.9.9`. Editor/nav-adjacent group, so the e2e UI-acceptance gate applies (route-reachability smoke + per-feature deployed-image check). All gate commands run on GitHub-hosted runners — no self-hosted, no pandoc/system binary added (DOCX is pure-JS `docx`), zero deferral.

- [ ] `source ~/.zshenv && pnpm lint` — Biome **0 errors** (auto-fix import order / `import type` as needed, then re-run to confirm clean).
- [ ] `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` passes (verify the new `docx` types resolve and the `@ts-expect-error` on the Buffer→Response line is still required, not stale).
- [ ] i18n check — **no untranslated/new-untranslated keys**: every key added in N1–N3 (`pageActions.export.html|docx|zip|groupDocument|groupData|groupSubtree`, `shortcut.export`, `pageMenu.exportHint`, `publishConfirm.urlLabel|copyUrl|urlCopied`) exists in all of `messages/en.json`, `messages/es.json`, `messages/ar.json` with non-empty values. Run the repo's i18n lint rule / parity check (`pnpm lint` covers the Biome i18n rule; additionally diff the three files' key sets).
- [ ] **Full** `source ~/.zshenv && pnpm vitest run` — entire suite green (Docker/Colima up for Testcontainers). Not a scoped run.
- [ ] `source ~/.zshenv && pnpm build` — `next build` + entrypoint `tsc` succeed (standalone output; confirms `docx` is bundleable server-side and the new route branches compile).
- [ ] **e2e UI-acceptance gate (route-reachability + per-feature deployed-image check)** on the built/deployed image:
  - Route smoke: `GET /api/pages/<seeded-page>/export?format=md|json|pdf|html|docx` each return 200 with the expected `content-type`; `?recursive=true` returns `application/zip`; `GET /api/pages/<id>/publish` returns 200 JSON `{slug,url,minted}` and does not flip `published`.
  - Per-feature deployed-image checks (Playwright against the running container): (1) open a page, open the action-bar Export menu, assert six grouped items render and the `⋯` menu no longer shows duplicate MD/ZIP buttons (#56/#235); (2) press `⌘⇧E` and assert the Export menu opens (#61/#240); (3) click Publish in the `⋯` menu and assert the confirm dialog shows the `/p/<slug>` URL row + Copy button before confirming (#70/#249); (4) download a `.docx` and assert the bytes start with `PK\x03\x04` (#56).
- [ ] Open a single PR onto `patches/v0.9.9` titled `Plan N — Export & Publish (#56 #61 #70 #235 #240 #249)` with the per-finding checklist. **HOLD for user GO** before merge; do not push from a subagent.
