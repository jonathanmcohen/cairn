'use client';

import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Code, Italic, Link2, RemoveFormatting, Strikethrough } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { EditorLinkPopover } from './editor-link-popover';

const BTN =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

export function EditorBubbleMenu({
  editor,
  openLinkSignal = 0,
}: {
  editor: Editor;
  openLinkSignal?: number;
}) {
  const t = useT();
  const [linkOpen, setLinkOpen] = useState(false);

  // #117 — the editor surface bumps `openLinkSignal` when the user presses the
  // link shortcut (⌘⇧K, or ranged ⌘K). Opening the link input here keeps the
  // bubble menu the single owner of the link UI.
  useEffect(() => {
    if (openLinkSignal > 0) setLinkOpen(true);
  }, [openLinkSignal]);

  // Yjs-safe: every handler issues a standard mark command through a
  // ProseMirror transaction; the Collaboration extension syncs it to Yjs.
  const toggle = (fn: 'toggleBold' | 'toggleItalic' | 'toggleStrike' | 'toggleCode') =>
    editor.chain().focus()[fn]().run();

  const applyLink = (href: string) => {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  };
  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      // #116/#117 review: hide while suggestion popups (slash/mention/page-link)
      // are open, while a node selection is active (images/blocks), and when the
      // selection is empty. Keeps the menu strictly an inline-text affordance and
      // never steals focus from the slash / suggestion marks UI.
      shouldShow={({ editor: ed, state }) => {
        const { selection } = state;
        if (selection.empty) return false;
        // NodeSelection (atom/leaf blocks) — not a text run; skip.
        if (!('$anchor' in selection) || selection.from === selection.to) return false;
        // Suppress when any suggestion plugin has an active popup. The slash /
        // mention / page-link extensions render via tippy into document.body;
        // detect an open one by querying for their mounted popup container.
        if (document.querySelector('[data-tippy-root]')) return false;
        // Suppress inside code blocks (no inline formatting there).
        if (ed.isActive('codeBlock')) return false;
        return true;
      }}
      options={{ placement: 'top', offset: 8 }}
      className="z-50 flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {linkOpen ? (
        <EditorLinkPopover
          initialHref={(editor.getAttributes('link').href as string) ?? ''}
          onApply={applyLink}
          onRemove={removeLink}
          onCancel={() => setLinkOpen(false)}
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={t('editor.bubble.bold')}
            title={t('editor.bubble.bold')}
            data-active={editor.isActive('bold')}
            onClick={() => toggle('toggleBold')}
            className={cn(BTN)}
          >
            <Bold className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.italic')}
            title={t('editor.bubble.italic')}
            data-active={editor.isActive('italic')}
            onClick={() => toggle('toggleItalic')}
            className={cn(BTN)}
          >
            <Italic className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.strike')}
            title={t('editor.bubble.strike')}
            data-active={editor.isActive('strike')}
            onClick={() => toggle('toggleStrike')}
            className={cn(BTN)}
          >
            <Strikethrough className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.code')}
            title={t('editor.bubble.code')}
            data-active={editor.isActive('code')}
            onClick={() => toggle('toggleCode')}
            className={cn(BTN)}
          >
            <Code className="size-4" aria-hidden />
          </button>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <button
            type="button"
            aria-label={t('editor.bubble.link')}
            title={`${t('editor.bubble.link')} (⌘⇧K)`}
            data-active={editor.isActive('link')}
            onClick={() => setLinkOpen(true)}
            className={cn(BTN)}
          >
            <Link2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.clear')}
            title={t('editor.bubble.clear')}
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
            className={cn(BTN)}
          >
            <RemoveFormatting className="size-4" aria-hidden />
          </button>
        </>
      )}
    </BubbleMenu>
  );
}
