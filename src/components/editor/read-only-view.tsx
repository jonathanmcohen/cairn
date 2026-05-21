'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { baseExtensions } from './extensions';
import { PublicDatabaseNode } from './public-database-extension';

function publicExtensions() {
  return [...baseExtensions().filter((e) => e.name !== 'database'), PublicDatabaseNode];
}

export function ReadOnlyView({ content }: { content: unknown }) {
  const editor = useEditor({
    extensions: publicExtensions(),
    content: content as never,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-hidden',
      },
    },
  });

  return (
    <div className="relative">
      <EditorContent editor={editor} />
    </div>
  );
}
