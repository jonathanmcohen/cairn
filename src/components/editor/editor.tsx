'use client';

import type { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { useAnnounce } from '@/components/a11y/live-region';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { useCollabPresence } from '@/hooks/use-collab-presence';
import { acceptSuggestion, type Json, rejectSuggestion } from '@/lib/suggestions/transform';
import { DragHandle } from './drag-handle';
import { baseExtensions, type CollabUser, collabExtensions } from './extensions';
import { OutlinePanel } from './outline-panel';
import { PresenceAvatars } from './presence-avatars';
import { SuggestionToolbar } from './suggestion-toolbar';
import { useCollabDoc } from './use-collab-doc';

export type EditorProps = {
  pageId: string;
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
};

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Reconnecting…',
  error: 'Offline',
} as const;

export function Editor({ pageId, initialContent, currentUser, editable }: EditorProps) {
  const { ydoc, provider, status } = useCollabDoc(pageId);
  const presentUsers = useCollabPresence(provider);
  const announce = useAnnounce();

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
  // Suggestion mode (editor+ only). `activeSuggestionId` is the open proposal
  // that new insert/delete marks attach to while suggesting; `resolvable` is the
  // suggestionId under the current selection (drives the Accept/Reject buttons).
  const [suggestionMode, setSuggestionMode] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [resolvable, setResolvable] = useState<string | null>(null);
  const activeSuggestionRef = useRef<string | null>(null);

  // Uploads hit the server, so they are blocked offline (bounded-offline gate).
  // Yjs node inserts (callout/toggle/heading) and typing/formatting stay enabled.
  const uploadAllowed = useActionAllowed('file-upload');
  const uploadAllowedRef = useRef(uploadAllowed);
  useEffect(() => {
    uploadAllowedRef.current = uploadAllowed;
  }, [uploadAllowed]);

  const uploadAndInsert = useCallback(async (files: File[]) => {
    if (!uploadAllowedRef.current) return;
    for (const file of files) {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        signedUrl: string;
        file: { id: string; name: string };
      };
      editorRef.current
        ?.chain()
        .focus()
        .insertCairnImage({ src: body.signedUrl, alt: body.file.name, fileId: body.file.id })
        .run();
    }
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
          editable,
          extensions: collabExtensions({
            ydoc,
            provider,
            user: currentUser,
            // viewers: no CollaborationCursor → no awareness writes
            withCursor: editable,
          }),
          immediatelyRender: false,
          editorProps: {
            attributes: {
              class:
                'prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-hidden min-h-[50vh]',
            },
            handleDrop(_view, event, _slice, moved) {
              if (moved) return false;
              const dataTransfer = (event as DragEvent).dataTransfer;
              const droppedFiles = Array.from(dataTransfer?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              );
              if (droppedFiles.length === 0) return false;
              event.preventDefault();
              void uploadAndInsert(droppedFiles);
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
    [provider, editable],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editor) {
      (editor.storage as { cairn?: { pageId: string } }).cairn = { pageId };
    }
  }, [editor, pageId]);

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
    if (!editable || !pageId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/pages/${pageId}/suggestions`);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { suggestions: unknown[] };
      if (!cancelled) setOpenCount(data.suggestions.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [editable, pageId]);

  // Track the suggestionId under the selection so Accept/Reject can target it.
  useEffect(() => {
    if (!editor || !editable) return;
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
  }, [editor, editable]);

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

  // Resolve a suggestion server-side (authoritative 200/403/409), then mirror
  // the SAME pure transform onto the live Y.Doc so all peers converge. Reuses
  // the v0.3.0 seeding pattern: build a fresh Y.Doc from the next JSON and apply
  // it as an update inside a transaction.
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
      const seeded = prosemirrorJSONToYDoc(ed.schema, next, 'default');
      ydoc.transact(() => {
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seeded));
      });
      setOpenCount((c) => Math.max(0, c - 1));
      if (activeSuggestionRef.current === suggestionId) {
        activeSuggestionRef.current = null;
        setSuggestionMode(false);
      }
    },
    [pageId, ydoc],
  );

  return (
    <div className="relative">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        {editable && (
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
          />
        )}
        <PresenceAvatars users={presentUsers} />
        <span className="text-muted-foreground text-xs">{STATUS_LABEL[status]}</span>
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          aria-pressed={outlineOpen}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          Outline
        </button>
      </div>
      <div className="flex gap-4">
        <div className="relative min-w-0 flex-1">
          {editor && <DragHandle editor={editor} />}
          <EditorContent editor={editor} />
        </div>
        {editor && outlineOpen && (
          <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />
        )}
      </div>
    </div>
  );
}

function looksLikeMarkdown(text: string): boolean {
  if (!text.includes('\n')) return false;
  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|---$)/m.test(text);
}
