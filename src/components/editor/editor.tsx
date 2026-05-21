'use client';

import type { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef } from 'react';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { DragHandle } from './drag-handle';
import { type CollabUser, collabExtensions } from './extensions';
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
};

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Reconnecting…',
  error: 'Offline',
} as const;

export function Editor({ pageId, initialContent, currentUser }: EditorProps) {
  const { ydoc, provider, status } = useCollabDoc(pageId);
  const editorRef = useRef<TiptapEditor | null>(null);
  const seededRef = useRef(false);

  const uploadAndInsert = useCallback(async (files: File[]) => {
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
  // extension binds the live Y.Doc immediately. Before then we mount an empty
  // placeholder (no extensions) to avoid flashing — and importantly we never
  // pass `content:`, so the doc content always comes from Yjs sync, never from
  // `initialContent` (which would fight the binding).
  const editor = useEditor(
    provider
      ? {
          extensions: collabExtensions({ ydoc, provider, user: currentUser, withCursor: true }),
          immediatelyRender: false,
          editorProps: {
            attributes: {
              class: 'prose dark:prose-invert max-w-none focus:outline-hidden min-h-[50vh]',
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
      : { extensions: [], immediatelyRender: false },
    [provider],
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

  return (
    <div className="relative">
      <div className="text-muted-foreground mb-1 text-right text-xs">{STATUS_LABEL[status]}</div>
      <div className="relative">
        {editor && <DragHandle editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function looksLikeMarkdown(text: string): boolean {
  if (!text.includes('\n')) return false;
  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|---$)/m.test(text);
}
