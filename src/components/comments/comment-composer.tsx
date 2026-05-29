'use client';

import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { MentionExtension } from '@/components/editor/mention-extension';

/**
 * A minimal single-line-ish TipTap input for comments. It supports `@`-mention
 * autocomplete (same MentionExtension as the page editor) and serializes to
 * plain text where each mention becomes the storage token `@[Name](userId)`
 * (via the node's `renderText`). The plain text is reported to the parent via
 * `onChange`; `extractMentions` runs authoritatively on the server.
 */
export function CommentComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Add a comment…',
}: {
  value: string;
  onChange: (plainText: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      // Lean text-only surface: drop block formatting that doesn't belong in a
      // single comment input, keeping just paragraphs + basic inline marks.
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      MentionExtension,
      Placeholder.configure({ placeholder }),
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none min-h-16 text-sm focus:outline-hidden',
      },
      handleKeyDown: (_view, event) => {
        // Submit on Cmd/Ctrl+Enter; let plain Enter add a newline.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getText());
    },
  });

  // Reset the editor when the parent clears the draft (e.g. after submit).
  useEffect(() => {
    if (editor && value === '' && editor.getText() !== '') {
      editor.commands.clearContent();
    }
  }, [editor, value]);

  return (
    <div className="w-full rounded-md border border-border bg-background px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
      <EditorContent editor={editor} />
    </div>
  );
}
