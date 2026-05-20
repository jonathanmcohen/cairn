'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    },
    onUpdate({ editor }) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const next = editor.getJSON();
      saveTimerRef.current = setTimeout(() => {
        void save(next);
      }, AUTOSAVE_MS);
    },
  });

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
      <EditorContent editor={editor} />
    </div>
  );
}
