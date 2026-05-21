'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { baseExtensions } from './extensions';

export function ReadOnlyView({ content }: { content: unknown }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    content: content as never,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none',
      },
    },
  });

  return (
    <div className="relative">
      <EditorContent editor={editor} />
    </div>
  );
}
