'use client';

import type { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DragHandle } from './drag-handle';
import { baseExtensions } from './extensions';

export type EditorProps = {
  pageId: string;
  initialContent: unknown;
  initialUpdatedAt: string;
};

const AUTOSAVE_MS = 800;

export function Editor({ pageId, initialContent, initialUpdatedAt }: EditorProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const updatedAtRef = useRef(initialUpdatedAt);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);

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

  const save = useCallback(
    async (content: unknown) => {
      setStatus('saving');
      const res = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, expectedUpdatedAt: updatedAtRef.current }),
      });
      if (res.status === 409) {
        setStatus('conflict');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const body = (await res.json()) as { updatedAt: string };
      updatedAtRef.current = body.updatedAt;
      setStatus('saved');
    },
    [pageId],
  );

  const editor = useEditor({
    extensions: baseExtensions(),
    content: initialContent as never,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[50vh]',
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
    onUpdate({ editor }) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const next = editor.getJSON();
      saveTimerRef.current = setTimeout(() => {
        void save(next);
      }, AUTOSAVE_MS);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editor) {
      (editor.storage as { cairn?: { pageId: string } }).cairn = { pageId };
    }
  }, [editor, pageId]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  return (
    <div className="relative">
      <div className="text-muted-foreground mb-1 text-right text-xs">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved'}
        {status === 'conflict' && (
          <span className="text-destructive">Updated elsewhere. Refresh to see latest.</span>
        )}
        {status === 'error' && <span className="text-destructive">Save failed.</span>}
      </div>
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
