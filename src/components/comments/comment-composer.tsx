'use client';

import type { Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { MentionExtension } from '@/components/editor/mention-extension';

/**
 * v0.9.9 E2 (#73/#253) — serialize the composer document to the storage plain
 * text, mapping the `mention` atom to its `@[Name](userId)` token via an
 * EXPLICIT `textSerializers` entry (kept identical to
 * `mention-extension.ts#renderText`). TipTap 3's bare `getText()` does honor a
 * node's `renderText`, but pinning the serializer here makes the comment write
 * path independent of that default so the stored token AND any text typed
 * after the mention both survive verbatim. Exported so the regression test
 * exercises the exact serializer the composer uses.
 */
export function serializeCommentText(editor: Editor): string {
  return editor.getText({
    textSerializers: {
      mention: ({ node }) => `@[${node.attrs.label ?? node.attrs.id}](${node.attrs.id})`,
    },
  });
}

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
      onChange(serializeCommentText(ed));
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
