'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { baseExtensions } from './extensions';
import { ReadOnlyMentionExtension } from './mention-readonly-extension';
import { PublicDatabaseNode } from './public-database-extension';

function publicExtensions() {
  // Swap the editor's `database` node for the public read-only one, and the
  // interactive `mention` node (link + suggestion) for the inert read-only
  // span variant so stored `@[Name](userId)` tokens still render as `@Name`.
  return [
    ...baseExtensions().filter((e) => e.name !== 'database' && e.name !== 'mention'),
    PublicDatabaseNode,
    ReadOnlyMentionExtension,
  ];
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
