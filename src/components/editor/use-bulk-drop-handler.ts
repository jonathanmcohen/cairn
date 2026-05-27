'use client';

import type { Editor } from '@tiptap/core';
import { useCallback, useState } from 'react';
import type { BulkResult } from './bulk-uploader';
import { loadEditorExtension } from './extensions-lazy';

/**
 * v0.9.0 G3 P22 — Bulk drop coordination hook.
 *
 * Returns a `<BulkUploader>` props bag + an `openWith(files, dropPos)` trigger.
 * The trigger is invoked by the editor's `handleDrop` editorProp when the
 * dropped file count is >= 2 (single-file drops still route through the
 * existing image-gallery / PDF / file handlers in `editor.tsx`).
 *
 * On `onComplete`, the hook inserts one node per uploaded file at the
 * captured drop position (fallback: end of doc). Node kinds:
 *  - image  → `cairnImage`
 *  - audio  → `cairnAudio`
 *  - video  → `video`
 *  - pdf    → `pdf`
 *  - file   → `fileAttachment`
 *
 * Lazy extensions (pdf, cairnAudio) are loaded before insertion so the
 * inserted nodes mount their React node-views immediately.
 */
export function useBulkDropHandler({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<{
    open: boolean;
    files: File[];
    dropPos: number | null;
  }>({ open: false, files: [], dropPos: null });

  const openWith = useCallback((files: File[], dropPos: number | null) => {
    setState({ open: true, files, dropPos });
  }, []);

  const onOpenChange = useCallback((open: boolean) => {
    setState((s) => ({ ...s, open }));
  }, []);

  const onComplete = useCallback(
    (results: BulkResult[]) => {
      const ed = editor;
      if (!ed) {
        setState({ open: false, files: [], dropPos: null });
        return;
      }
      void (async () => {
        // Load lazy extensions for any kinds that need them, before insert.
        const kinds = new Set(results.map((r) => r.kind));
        const lazyToLoad: Array<'pdf' | 'cairnAudio' | 'gallery'> = [];
        if (kinds.has('pdf')) lazyToLoad.push('pdf');
        if (kinds.has('audio')) lazyToLoad.push('cairnAudio');
        for (const name of lazyToLoad) {
          const ext = await loadEditorExtension(name);
          if (!ed.extensionManager.extensions.some((e) => e.name === ext.name)) {
            ed.setOptions({
              extensions: [...ed.extensionManager.extensions, ext],
            });
          }
        }
        const pos = state.dropPos ?? ed.state.doc.content.size;
        const nodes = results
          .filter((r) => r.status === 'done' && r.fileId)
          .map((r) => buildNode(r));
        if (nodes.length > 0) {
          ed.chain().focus().insertContentAt(pos, nodes).run();
        }
        setState({ open: false, files: [], dropPos: null });
      })();
    },
    [editor, state.dropPos],
  );

  return {
    open: state.open,
    files: state.files,
    onOpenChange,
    onComplete,
    openWith,
  };
}

function buildNode(r: BulkResult): { type: string; attrs: Record<string, unknown> } {
  switch (r.kind) {
    case 'image':
      return {
        type: 'cairnImage',
        attrs: { src: `/api/files/${r.fileId}`, alt: r.name, fileId: r.fileId },
      };
    case 'audio':
      return {
        type: 'cairnAudio',
        attrs: { fileId: r.fileId, mime: r.mime, name: r.name },
      };
    case 'video':
      return {
        type: 'video',
        attrs: { fileId: r.fileId, mimeType: r.mime },
      };
    case 'pdf':
      return {
        type: 'pdf',
        attrs: { fileId: r.fileId, defaultPage: 1 },
      };
    default:
      return {
        type: 'fileAttachment',
        attrs: {
          href: `/api/files/${r.fileId}`,
          name: r.name,
          mimeType: r.mime,
          size: 0,
          fileId: r.fileId,
        },
      };
  }
}
