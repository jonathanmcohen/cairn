'use client';

import type { Content, Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { useAnnounce } from '@/components/a11y/live-region';
import { usePageModeOptional } from '@/components/pages/page-mode-shell';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { useCollabPresence } from '@/hooks/use-collab-presence';
import { aggregateCitations } from '@/lib/citations/aggregate';
import type { CitationStyle } from '@/lib/citations/format';
import { computeDiffPreview } from '@/lib/suggestions/diff-preview';
import { acceptSuggestion, type Json, rejectSuggestion } from '@/lib/suggestions/transform';
import { BibliographyToggle } from './bibliography-toggle';
import { BlockContextMenu } from './block-context-menu';
import { BulkUploader } from './bulk-uploader';
import { CollabOfflineBanner } from './collab-offline-banner';
import { DragHandle } from './drag-handle';
import { EditorBubbleMenu } from './editor-bubble-menu';
import { EditorDialogs } from './editor-dialogs';
import { baseExtensions, type CollabUser, collabExtensions } from './extensions';
import { Bibliography } from './extensions/bibliography';
import { loadEditorExtension, nodeNamesInDoc } from './extensions-lazy';
import { HeadingCollapse } from './heading-collapse';
import { composeGalleryInsert } from './image-extension';
import { LockBadge } from './lock-badge';
import { OutlinePanel } from './outline-panel';
import { PresenceAvatars } from './presence-avatars';
import type { SuggestionAutoMarkStorage } from './suggestion-auto-mark';
import { SuggestionToolbar } from './suggestion-toolbar';
import { type OpenSuggestion, SuggestionsDrawer } from './suggestions-drawer';
import { EDITOR_TOOLBAR_SLOT_ID } from './toolbar-slot';
import { useBulkDropHandler } from './use-bulk-drop-handler';
import { useCollabDoc } from './use-collab-doc';

export type EditorProps = {
  pageId: string;
  /**
   * Workspace owning this page. Used to scope the offline IndexedDB doc-index
   * and FIFO eviction by workspace (multi-workspace users keep separate
   * offline caches per workspace).
   */
  workspaceId: string;
  initialContent: unknown;
  /**
   * Retained for metadata PATCH callers (title/icon/cover live in sibling
   * components and still carry conflict detection). Content edits no longer use
   * it — Yjs is the source of truth and is conflict-free.
   */
  initialUpdatedAt: string;
  currentUser: CollabUser;
  /**
   * Drives read-only mode for `viewer`-role users: when false the editor is
   * non-editable AND the collab extensions omit the cursor (no awareness writes,
   * so viewers broadcast no caret). Derived from the caller's page role.
   */
  editable: boolean;
  /**
   * v0.9.0 G3 P15 review fix — when true, diagram blocks (PlantUML/drawio)
   * that would otherwise ship the decrypted source to a 3rd-party server
   * (www.plantuml.com / viewer.diagrams.net) render a placeholder instead.
   * Stamped onto `editor.storage.cairn.encrypted` for the React node views.
   * Defaults to false; pass `page.encrypted` from the page-detail shell.
   */
  encrypted?: boolean;
  /** #134 — when true the page is locked for this viewer; editing is disabled. */
  locked?: boolean;
  /** ISO unlock time, or null for an indefinite lock. */
  lockedUntilIso?: string | null;
  /** v0.9.7 G19 #166 — initial value of pages.metadata.disable_bibliography. */
  initialDisableBibliography?: boolean;
  /** Page-level citation style used by the inserted citation node-views and
   *  the in-editor bibliography preview. Defaults to 'apa'. */
  citationStyle?: CitationStyle;
};

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Reconnecting…',
  error: 'Offline',
} as const;

// a30 #39 — status-pill dot color per collab connection state. Tailwind class
// strings (not dynamic) so the JIT compiler keeps them.
const STATUS_DOT = {
  connecting: 'bg-warning',
  connected: 'bg-success',
  disconnected: 'bg-warning',
  error: 'bg-destructive',
} as const;

// #123 — class applied to the .ProseMirror contenteditable. We suppress BOTH
// `:focus` and `:focus-visible` outlines on this one surface. The global
// `:focus-visible { outline: 2px solid hsl(var(--ring)) }` (globals.css) exists
// for discrete controls (buttons/inputs/links) per WCAG 2.4.7, but on this
// 50vh-tall writing surface it painted the accent ring around the whole editor
// viewport — orange under the amber accent, red under rose — which read as a
// stuck error glow after slash-menu teardown returned keyboard-style focus.
// The caret is this surface's focus affordance, so dropping its outline is
// correct and does not regress real control focus rings elsewhere.
export const EDITOR_CONTENT_CLASS =
  'prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-hidden focus-visible:outline-hidden min-h-[50vh]';

export function Editor({
  pageId,
  workspaceId,
  initialContent,
  currentUser,
  editable,
  encrypted = false,
  locked = false,
  lockedUntilIso = null,
  initialDisableBibliography = false,
  citationStyle = 'apa',
}: EditorProps) {
  const { ydoc, provider, status } = useCollabDoc(workspaceId, pageId);
  const presentUsers = useCollabPresence(provider);
  const announce = useAnnounce();
  // v0.9.0 G6 P33 — reader mode forces the surface into read-only even for
  // editor-role users. Optional because `/p/<slug>` mounts <Editor> outside
  // the PageModeShell (public viewers don't carry the toggle).
  const pageMode = usePageModeOptional();
  const readerMode = pageMode?.reader ?? false;
  const effectiveEditable = editable && !readerMode && !locked;
  // #188 — controls that represent an *edit affordance* stay mounted but
  // disabled while the page is locked, rather than disappearing (which read as
  // a broken UI). `mountableEditable` = the user could edit if not locked;
  // `editLocked` = currently suppressed by a lock only.
  const mountableEditable = editable && !readerMode;
  const editLocked = mountableEditable && locked;

  // Announce collab connection-status transitions through the shell's polite
  // aria-live region so screen-reader users hear "Reconnecting…" / "Live" /
  // "Offline" even when the visible status pill is off-focus. Errors go
  // assertive; routine connecting/connected/disconnected stay polite.
  useEffect(() => {
    const label = STATUS_LABEL[status];
    announce(label, status === 'error' ? 'assertive' : 'polite');
  }, [status, announce]);
  const editorRef = useRef<TiptapEditor | null>(null);
  const seededRef = useRef(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // v0.10.0 E6 — the page-detail route reserves a slot inside its action bar
  // (see pages/[pageId]/page.tsx) and the editor portals its control group
  // there, so the page renders ONE toolbar row instead of two stacked strips.
  // `undefined` = lookup pending (SSR + first client render: render nothing,
  // so server and client markup agree); `null` = no slot in this mount (e.g.
  // <Editor> hosted outside the page-detail route) → fall back to the old
  // inline strip. Mount-only lookup is safe: on soft `/pages/[id]` navigation
  // the App Router reconciles the action bar in place (same position/type),
  // so the slot's DOM node — and this Editor instance — both persist.
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    setToolbarHost(document.getElementById(EDITOR_TOOLBAR_SLOT_ID));
  }, []);
  // #271 — doc position of the block under the last right-click, resolved by the
  // BlockContextMenu trigger's capture handler.
  const [contextTargetPos, setContextTargetPos] = useState<number | null>(null);
  // #117 — the EditorLinkShortcut extension (and the ⌘/ sheet registry entry)
  // dispatch a `cairn:editor:open-link` window event when the user presses the
  // insert-link shortcut. Bumping this counter lets <EditorBubbleMenu> open its
  // link input without holding React state inside the ProseMirror extension.
  const [openLinkSignal, setOpenLinkSignal] = useState(0);
  useEffect(() => {
    const onOpen = () => setOpenLinkSignal((n) => n + 1);
    window.addEventListener('cairn:editor:open-link', onOpen);
    return () => window.removeEventListener('cairn:editor:open-link', onOpen);
  }, []);

  // #275 — ⌘⇧M (Mod+Shift+M) comments the current selection: dispatch the
  // `cairn:editor:comment-selection` event the comments rail listens for. Mirror
  // of the `cairn:editor:open-link` pattern. Only fires with a non-empty
  // selection and when the surface is editable (locked/reader/viewer no-op).
  useEffect(() => {
    if (!effectiveEditable) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        const ed = editorRef.current;
        if (!ed || ed.state.selection.empty) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('cairn:editor:comment-selection'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effectiveEditable]);
  // Suggestion mode (editor+ only). `activeSuggestionId` is the open proposal
  // that new insert/delete marks attach to while suggesting; `resolvable` is the
  // suggestionId under the current selection (drives the Accept/Reject buttons).
  const [suggestionMode, setSuggestionMode] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [resolvable, setResolvable] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openSuggestions, setOpenSuggestions] = useState<OpenSuggestion[]>([]);
  // v0.9.7 G19 #166 — live "show bibliography" state, driven by the strip toggle.
  const [bibDisabled, setBibDisabled] = useState(initialDisableBibliography);
  const activeSuggestionRef = useRef<string | null>(null);

  // Uploads hit the server, so they are blocked offline (bounded-offline gate).
  // Yjs node inserts (callout/toggle/heading) and typing/formatting stay enabled.
  const uploadAllowed = useActionAllowed('file-upload');
  const uploadAllowedRef = useRef(uploadAllowed);
  useEffect(() => {
    uploadAllowedRef.current = uploadAllowed;
  }, [uploadAllowed]);

  // v0.9.0 G3 P22 — Bulk multi-file drop handler. The hook owns the modal's
  // open/files/onComplete state; `bulkOpenRef.current` is read inside the
  // useEditor `handleDrop` closure (declared BEFORE the editor exists) so we
  // route ≥2-file drops through the BulkUploader. Single-file drops fall
  // through to the legacy P16/P17 image-gallery + PDF handlers.
  const bulkOpenRef = useRef<((files: File[], dropPos: number | null) => void) | null>(null);

  // v0.9.0 G3 P17 — `.pdf` files dropped (or pasted) on the editor surface
  // upload via /api/upload and insert a `pdf` block at the caret. The lazy
  // extension is loaded first so the schema accepts the insert + the React
  // node-view mounts immediately. Non-PDF, non-image files still fall through
  // to the existing image-gallery handler so behavior for unrelated drops is
  // unchanged.
  const uploadAndInsertPdfs = useCallback(async (files: File[]) => {
    if (!uploadAllowedRef.current) return;
    const ed = editorRef.current;
    if (!ed) return;
    const { loadEditorExtension } = await import('./extensions-lazy');
    const ext = await loadEditorExtension('pdf');
    if (!ed.extensionManager.extensions.some((e) => e.name === ext.name)) {
      ed.setOptions({ extensions: [...ed.extensionManager.extensions, ext] });
    }
    for (const file of files) {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) continue;
      const body = (await res.json()) as { file: { id: string; name: string } };
      ed.chain().focus().setPdf({ fileId: body.file.id, defaultPage: 1 }).run();
    }
  }, []);

  const uploadAndInsert = useCallback(async (files: File[]) => {
    if (!uploadAllowedRef.current) return;
    // v0.9.0 G3 P16 — composeGalleryInsert collapses N>=2 image files into a
    // single `gallery` node containing N `cairnImage` children; single-file
    // drops still produce one bare `cairnImage` for back-compat. Non-image
    // files are filtered upstream, so a heterogeneous drop becomes a clean
    // gallery of just the images.
    const result = await composeGalleryInsert({
      files,
      uploadFn: async (file) => {
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        const body = (await res.json()) as {
          signedUrl: string;
          file: { id: string; name: string };
        };
        return { fileId: body.file.id, src: body.signedUrl, alt: body.file.name };
      },
    });
    if (result.type === 'gallery' && result.content.length === 0) return;
    editorRef.current?.chain().focus().insertContent(result).run();
  }, []);

  // The editor is only built once the provider exists, so the Collaboration
  // extension binds the live Y.Doc immediately. Before then we mount a
  // read-only placeholder that uses the SAME node schema (baseExtensions) but
  // without the Collaboration binding — an empty `extensions: []` set has no
  // top-level `doc` node and makes TipTap throw "Schema is missing its top node
  // type ('doc')" on mount. We never pass `content:`, so the doc content always
  // comes from Yjs sync, never from `initialContent` (which would fight the
  // binding).
  const editor = useEditor(
    provider
      ? {
          editable: effectiveEditable,
          extensions: collabExtensions({
            ydoc,
            provider,
            user: currentUser,
            // viewers + reader-mode users: no CollaborationCursor → no awareness writes
            withCursor: effectiveEditable,
          }),
          immediatelyRender: false,
          editorProps: {
            attributes: {
              class: EDITOR_CONTENT_CLASS,
              // axe `aria-input-field-name`: the ProseMirror contenteditable is
              // tabbable + editable, and recent axe-core builds (4.10+) map a
              // tabbable `[contenteditable=true]` to an implicit ARIA textbox.
              // Without an accessible name the rule trips serious-impact in CI
              // (dark mode hits it first under the slower runner timing). Give
              // the editor surface an explicit name so the rule is satisfied.
              role: 'textbox',
              'aria-label': 'Page content',
              'aria-multiline': 'true',
            },
            handleDrop(view, event, _slice, moved) {
              if (moved) return false;
              const dataTransfer = (event as DragEvent).dataTransfer;
              const allFiles = Array.from(dataTransfer?.files ?? []);
              if (allFiles.length === 0) return false;
              // v0.9.0 G3 P22 — multi-file drops (>=2 files of any kind) route
              // through the BulkUploader modal so each file lands as the right
              // block type (image → cairnImage / gallery, audio → cairnAudio,
              // video → video, pdf → pdf, other → fileAttachment). Single-file
              // drops keep the legacy P16/P17 fast paths below.
              if (allFiles.length >= 2) {
                if (!uploadAllowedRef.current) return false;
                event.preventDefault();
                const ev = event as DragEvent;
                const dropPos =
                  view.posAtCoords({ left: ev.clientX, top: ev.clientY })?.pos ?? null;
                bulkOpenRef.current?.(allFiles, dropPos);
                return true;
              }
              // v0.9.0 G3 P17 — PDFs route to the PDF block; image drops keep
              // the existing gallery composer; mixed drops produce one PDF
              // node per .pdf + one gallery for the images.
              const pdfFiles = allFiles.filter((f) => f.type === 'application/pdf');
              const imageFiles = allFiles.filter((f) => f.type.startsWith('image/'));
              if (pdfFiles.length === 0 && imageFiles.length === 0) return false;
              event.preventDefault();
              if (pdfFiles.length > 0) void uploadAndInsertPdfs(pdfFiles);
              if (imageFiles.length > 0) void uploadAndInsert(imageFiles);
              return true;
            },
            handlePaste(_view, event) {
              const clipboardData = (event as ClipboardEvent).clipboardData;
              const pastedFiles = Array.from(clipboardData?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              );
              if (pastedFiles.length > 0) {
                event.preventDefault();
                void uploadAndInsert(pastedFiles);
                return true;
              }
              // Check for markdown paste
              const text = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
              if (looksLikeMarkdown(text)) {
                event.preventDefault();
                void (async () => {
                  const { markdownToProse } = await import('@/lib/markdown/to-prose');
                  const doc = markdownToProse(text);
                  if (doc.content && doc.content.length > 0) {
                    editorRef.current?.chain().focus().insertContent(doc.content).run();
                  }
                })();
                return true;
              }
              return false;
            },
          },
          // NO onUpdate content-save: Yjs is the source of truth and the collab
          // server materializes to pages.content. Title/icon/cover still PATCH
          // from their sibling components.
        }
      : { extensions: baseExtensions(), editable: false, immediatelyRender: false },
    [provider, effectiveEditable],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // v0.9.0 G3 P22 — Wire the bulk drop handler. Must follow the useEditor
  // call (the hook needs the editor instance) but precedes the JSX render of
  // <BulkUploader/>.
  const bulk = useBulkDropHandler({ editor });
  useEffect(() => {
    bulkOpenRef.current = bulk.openWith;
  }, [bulk.openWith]);

  useEffect(() => {
    if (editor) {
      (editor.storage as { cairn?: { pageId: string; encrypted: boolean } }).cairn = {
        pageId,
        encrypted,
      };
    }
  }, [editor, pageId, encrypted]);

  // Lazy-load heavy editor extensions (math/syncedBlock/embed) only when the
  // initial doc actually contains them. The static `baseExtensions()` carries
  // only the schema-only `*Node` variants — enough for ProseMirror to parse the
  // doc — and we merge in the full extension (with React node-views + CSS) via
  // `setOptions({ extensions })` once we know it's needed. Inserts also trigger
  // the load (see slash-extension.ts) so users typing `/math` get the view.
  // TipTap dedupes by node name, so re-merging the same extension is a no-op.
  useEffect(() => {
    if (!editor) return;
    const initial = editor.getJSON();
    const lazy = nodeNamesInDoc(initial);
    if (lazy.length === 0) return;
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(lazy.map((name) => loadEditorExtension(name)));
      if (cancelled || editor.isDestroyed) return;
      editor.setOptions({
        extensions: [...editor.extensionManager.extensions, ...loaded],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [editor]);

  // v0.9.0 G5 P28 — emit a `cairn:editor:doc-changed` CustomEvent on the
  // window each time the editor doc mutates, so out-of-tree consumers (the
  // sticky <TocSidebar>) can recompute their headings list without
  // subscribing to the Yjs document directly. Throttle-free: the listeners
  // are passive and `collectHeadings()` is O(nodes) with no allocations
  // per heading. Skips when there's no editor yet (StrictMode double-mount).
  useEffect(() => {
    if (!editor) return;
    const emit = () => {
      window.dispatchEvent(
        new CustomEvent('cairn:editor:doc-changed', { detail: { doc: editor.getJSON() } }),
      );
    };
    editor.on('update', emit);
    // Fire once on mount so a listener that attaches AFTER the editor is
    // ready still gets an initial snapshot (the sidebar's initialDoc prop
    // already covers the SSR path, but client-only mounts benefit).
    emit();
    return () => {
      editor.off('update', emit);
    };
  }, [editor]);

  // Empty-doc seeding (Plan 1 did not seed server-side): a brand-new page has
  // no Yjs state. The first client to finish syncing seeds the shared doc from
  // `pages.content` — but ONLY if the synced doc is still empty, so concurrent
  // first-loaders never double-insert.
  useEffect(() => {
    if (!editor || !provider) return;
    const seed = () => {
      if (seededRef.current) return;
      seededRef.current = true;
      const fragment = ydoc.getXmlFragment('default');
      if (fragment.length > 0) return; // already has content from a peer / persistence
      if (!initialContent || typeof initialContent !== 'object') return;
      const json = initialContent as Record<string, unknown>;
      const content = json.content;
      if (!Array.isArray(content) || content.length === 0) return;
      const seededDoc = prosemirrorJSONToYDoc(editor.schema, json, 'default');
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seededDoc));
    };
    if (provider.synced) {
      seed();
      return;
    }
    provider.on('synced', seed);
    return () => {
      provider.off('synced', seed);
    };
  }, [editor, provider, ydoc, initialContent]);

  // Load the open-suggestion count once the editable editor exists.
  useEffect(() => {
    if (!effectiveEditable || !pageId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/pages/${pageId}/suggestions`);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        suggestions: { id: string; authorName?: string | null }[];
      };
      if (cancelled) return;
      setOpenCount(data.suggestions.length);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveEditable, pageId]);

  // v0.10.0 E4 — feed the live suggest-mode state into the SuggestionAutoMark
  // extension through its storage (the same channel the `cairn` namespace uses
  // for pageId/encrypted). The ProseMirror plugin reads these fields per
  // transaction, so flipping them is enough to start/stop auto-marking —
  // toggling Suggesting OFF mid-paragraph stops wrapping on the very next
  // keystroke. `activeSuggestionRef.current` is assigned BEFORE
  // setSuggestionMode fires, so the id is always current when this runs.
  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as { suggestionAutoMark?: SuggestionAutoMarkStorage })
      .suggestionAutoMark;
    if (!storage) return;
    storage.active = suggestionMode && effectiveEditable;
    storage.suggestionId = activeSuggestionRef.current;
    storage.authorId = currentUser.id;
  }, [editor, suggestionMode, effectiveEditable, currentUser.id]);

  // Track the suggestionId under the selection so Accept/Reject can target it.
  useEffect(() => {
    if (!editor || !effectiveEditable) return;
    const update = () => {
      const id =
        (editor.getAttributes('suggestionInsert').suggestionId as string | undefined) ||
        (editor.getAttributes('suggestionDelete').suggestionId as string | undefined) ||
        null;
      setResolvable(id);
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    update();
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor, effectiveEditable]);

  // Toggle suggestion mode. Turning ON proposes a new open suggestion (the
  // marks applied while suggesting share its id); turning OFF clears the active
  // id. Input routing is intentionally minimal for this release: rather than a
  // global keystroke interceptor, the toolbar exposes explicit "mark
  // insert"/"mark delete" affordances over the current selection.
  const toggleSuggestion = useCallback(async () => {
    if (suggestionMode) {
      setSuggestionMode(false);
      activeSuggestionRef.current = null;
      return;
    }
    const res = await fetch(`/api/pages/${pageId}/suggestions`, { method: 'POST' });
    if (!res.ok) return;
    const data = (await res.json()) as { suggestionId: string };
    activeSuggestionRef.current = data.suggestionId;
    setSuggestionMode(true);
    setOpenCount((c) => c + 1);
  }, [suggestionMode, pageId]);

  // #85/#145 — scroll to a specific suggestion's first mark, then close the
  // drawer so the doc is visible. Reuses the posAtDOM/selection pattern.
  const viewSuggestion = useCallback((suggestionId: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const root = ed.view.dom as HTMLElement;
    const el = root.querySelector<HTMLElement>(`[data-suggestion-id="${suggestionId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const pos = ed.view.posAtDOM(el, 0);
      if (pos >= 0) ed.chain().focus().setTextSelection(pos).run();
    }
    setDrawerOpen(false);
  }, []);

  const markSelection = useCallback(
    (kind: 'insert' | 'delete') => {
      const ed = editorRef.current;
      const id = activeSuggestionRef.current;
      if (!ed || !id) return;
      const attrs = {
        suggestionId: id,
        authorId: currentUser.id,
        createdAt: new Date().toISOString(),
      };
      ed.chain()
        .focus()
        .setMark(kind === 'insert' ? 'suggestionInsert' : 'suggestionDelete', attrs)
        .run();
      // biome-ignore lint/correctness/useExhaustiveDependencies: currentUser.id is stable for the editor's lifetime
    },
    [currentUser.id],
  );

  // Resolve a suggestion server-side (authoritative 200/403/409), then apply the
  // SAME pure transform to the LIVE document so all peers converge. The resolved
  // doc MUST be applied THROUGH the editor (setContent) rather than by building a
  // fresh Y.Doc and Y.applyUpdate-ing it: applying a freshly-built doc's state is
  // a CRDT *merge*, which can never express the DELETIONS that remove the
  // resolved suggestion's marks — so the marks survived in the live doc for every
  // connected peer (and even on reload, until the collab room was evicted). Going
  // through the editor lets y-prosemirror's ySyncPlugin diff old→new and emit the
  // granular Yjs deletes/inserts that actually propagate the accept/reject.
  const resolve = useCallback(
    async (action: 'accept' | 'reject', suggestionId: string) => {
      const ed = editorRef.current;
      if (!ed) return;
      const res = await fetch(`/api/pages/${pageId}/suggestions/${suggestionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) return; // 403 viewer / 409 already resolved — no local apply
      const current = yDocToProsemirrorJSON(ydoc, 'default') as Json;
      const next =
        action === 'accept'
          ? acceptSuggestion(current, suggestionId)
          : rejectSuggestion(current, suggestionId);
      ed.commands.setContent(next as Content, { emitUpdate: false });
      setOpenCount((c) => Math.max(0, c - 1));
      setOpenSuggestions((rows) => rows.filter((r) => r.id !== suggestionId));
      if (activeSuggestionRef.current === suggestionId) {
        activeSuggestionRef.current = null;
        setSuggestionMode(false);
      }
    },
    [pageId, ydoc],
  );

  // a30 #39 (round-2 styling) — the editor control group. Thin `h-4 w-px
  // bg-border` separators divide the logical groups (suggest-edits /
  // presence+status / outline) and the toggles carry explicit active states
  // (aria-pressed + bg-primary fill) so the cluster reads as distinct,
  // structured controls rather than a row of bare labels — IN EVERY ROLE. The
  // presence+status+outline group always renders (editor AND viewer); the
  // suggest-edits + bibliography group is gated on `mountableEditable` (#188 —
  // it stays mounted-but-disabled under lock instead of vanishing, and E6
  // extends the same `editLocked` disable to the bibliography toggle), and its
  // trailing separator lives INSIDE that gate so it never dangles when a
  // viewer omits the group. The status pill rests as a hairline-bordered chip
  // (no `bg-muted` fill, which read as an active/selected state at rest).
  // v0.10.0 E6 — this group no longer renders as its own strip above the
  // editor body: it portals into the page action bar's reserved slot (one
  // toolbar row). Handlers/state are unchanged and stay in this component.
  const toolbarControls = (
    <>
      {editable && locked && <LockBadge lockedUntilIso={lockedUntilIso} />}
      {mountableEditable && (
        <>
          <SuggestionToolbar
            editor={editor}
            active={suggestionMode}
            onToggle={() => void toggleSuggestion()}
            openCount={openCount}
            onMarkInsert={() => markSelection('insert')}
            onMarkDelete={() => markSelection('delete')}
            resolvable={resolvable}
            onAccept={(id) => void resolve('accept', id)}
            onReject={(id) => void resolve('reject', id)}
            onOpenDrawer={() => setDrawerOpen(true)}
            disabled={editLocked}
          />
          <BibliographyToggle
            pageId={pageId}
            initialDisabled={initialDisableBibliography}
            citationCount={editor ? aggregateCitations(editor.getJSON(), citationStyle).length : 0}
            onChange={setBibDisabled}
            disabled={editLocked}
          />
          <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        </>
      )}
      <PresenceAvatars users={presentUsers} />
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-foreground text-xs"
        title={STATUS_LABEL[status]}
      >
        <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>
      <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setOutlineOpen((v) => !v)}
        aria-pressed={outlineOpen}
        className={
          outlineOpen
            ? 'rounded bg-primary px-2 py-1 text-primary-foreground text-xs'
            : 'rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent'
        }
      >
        Outline
      </button>
    </>
  );

  return (
    <div className="relative">
      <EditorDialogs editor={editor} />
      <CollabOfflineBanner status={status} />
      {/* v0.10.0 E6 — one toolbar row. When the page-detail route reserved a
          slot in its action bar, portal the control group there (a leading
          separator divides it from the page-level actions). Until the mount
          effect resolves the slot, render nothing — the SSR markup carried no
          strip either, so hydration agrees. Only a slot-less host (an <Editor>
          mounted outside the page-detail route) gets the legacy inline strip,
          so the editor body itself keeps no dead second-strip spacer. */}
      {toolbarHost
        ? createPortal(
            <>
              <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              {toolbarControls}
            </>,
            toolbarHost,
          )
        : toolbarHost === null && (
            <div className="mb-1 flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              {toolbarControls}
            </div>
          )}
      {/* #85/#145 — the open-suggestions drawer is a fixed overlay (Radix
          Dialog); it mounts here in the editor body (not in the toolbar
          portal) and opens via the toolbar's open-count chip. */}
      {mountableEditable && (
        <SuggestionsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          suggestions={openSuggestions}
          onAccept={(id) => void resolve('accept', id)}
          onReject={(id) => void resolve('reject', id)}
          onView={viewSuggestion}
        />
      )}
      <div className="flex gap-4">
        <div className="relative min-w-0 flex-1">
          {editor && <DragHandle editor={editor} />}
          {/* #276 — hover chevron to collapse the section under a heading
              (per-viewer presentation state, no Yjs write). */}
          {editor && <HeadingCollapse editor={editor} />}
          {/* #116 — inline formatting bubble menu. Only the editable, collab-
              bound editor gets it (viewers / reader-mode never see formatting
              controls). It surfaces on text selection; see shouldShow. */}
          {editor && effectiveEditable && (
            <EditorBubbleMenu editor={editor} openLinkSignal={openLinkSignal} />
          )}
          {/* #271 — right-click block context menu. The capture handler resolves
              the block under the pointer via posAtCoords before radix opens the
              menu; mutating items are gated on effectiveEditable, read-only
              viewers still get Comment + Copy-link. */}
          {editor ? (
            <BlockContextMenu
              editor={editor}
              targetPos={contextTargetPos ?? 0}
              pageId={pageId}
              editable={effectiveEditable}
            >
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: capture is for the
                  contextmenu (right-click) target only; keyboard users open the
                  same actions via the DragHandle menu. */}
              <div
                onContextMenuCapture={(e) => {
                  const pos =
                    editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null;
                  setContextTargetPos(pos);
                }}
              >
                <EditorContent editor={editor} />
              </div>
            </BlockContextMenu>
          ) : (
            <EditorContent editor={editor} />
          )}
          {editor && !bibDisabled && <Bibliography doc={editor.getJSON()} style={citationStyle} />}
        </div>
      </div>
      {/* P19 #80 — the outline is an overlay flyout anchored to the outer
          `relative` wrapper, not an in-flow column, so the editor body keeps
          full width and a page with few headings doesn't waste a 14rem column. */}
      {editor && outlineOpen && (
        <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />
      )}
      <BulkUploader
        open={bulk.open}
        files={bulk.files}
        onOpenChange={bulk.onOpenChange}
        onComplete={bulk.onComplete}
      />
    </div>
  );
}

function looksLikeMarkdown(text: string): boolean {
  if (!text.includes('\n')) return false;
  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|---$)/m.test(text);
}
