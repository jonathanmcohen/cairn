'use client';

import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  MessageSquarePlus,
  Palette,
  RemoveFormatting,
  Sigma,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { EditorLinkPopover } from './editor-link-popover';

const BTN =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

const SEP = <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

// #275 — minimal swatch palette. Accent + a couple of common highlight hues keep
// the toolbar compact; "clear" removes the mark.
const TEXT_COLOR = '#dc2626';
const HIGHLIGHT_COLOR = '#fde68a';

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

  // Yjs-safe: every handler issues a standard mark/attr command through a
  // ProseMirror transaction; the Collaboration extension syncs it to Yjs.
  const toggle = (fn: 'toggleBold' | 'toggleItalic' | 'toggleStrike' | 'toggleCode') =>
    editor.chain().focus()[fn]().run();

  const setHeading = (level: 1 | 2 | 3) => editor.chain().focus().toggleHeading({ level }).run();
  const setAlign = (align: 'left' | 'center' | 'right') =>
    editor.chain().focus().setTextAlign(align).run();
  // #275 — comment-on-selection dispatches the rail-open event (⌘⇧M mirror).
  const commentSelection = () =>
    window.dispatchEvent(new CustomEvent('cairn:editor:comment-selection'));
  // The inline `math` node is schema-registered in baseExtensions(); insert an
  // empty one (the React node-view loads lazily) so the user can type LaTeX.
  const insertMath = () =>
    editor
      .chain()
      .focus()
      .insertContent({ type: 'math', attrs: { latex: '', display: false } })
      .run();

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
      className="z-50 flex flex-wrap items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
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
          {SEP}
          {/* Text color + highlight (#275). A single accent swatch toggles; a
              long-press palette is out of scope — clear lives in the menu's
              RemoveFormatting + the dedicated highlight toggle. */}
          <button
            type="button"
            aria-label={t('editor.bubble.color')}
            title={t('editor.bubble.color')}
            data-active={editor.isActive('textStyle', { color: TEXT_COLOR })}
            onClick={() =>
              editor.isActive('textStyle', { color: TEXT_COLOR })
                ? editor.chain().focus().unsetColor().run()
                : editor.chain().focus().setColor(TEXT_COLOR).run()
            }
            className={cn(BTN)}
          >
            <Palette className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.highlight')}
            title={t('editor.bubble.highlight')}
            data-active={editor.isActive('highlight')}
            onClick={() =>
              editor.isActive('highlight')
                ? editor.chain().focus().unsetHighlight().run()
                : editor.chain().focus().toggleHighlight({ color: HIGHLIGHT_COLOR }).run()
            }
            className={cn(BTN)}
          >
            <Highlighter className="size-4" aria-hidden />
          </button>
          {SEP}
          {/* Turn-into headings (#275). */}
          <button
            type="button"
            aria-label={t('editor.bubble.h1')}
            title={t('editor.bubble.h1')}
            data-active={editor.isActive('heading', { level: 1 })}
            onClick={() => setHeading(1)}
            className={cn(BTN)}
          >
            <Heading1 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.h2')}
            title={t('editor.bubble.h2')}
            data-active={editor.isActive('heading', { level: 2 })}
            onClick={() => setHeading(2)}
            className={cn(BTN)}
          >
            <Heading2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.h3')}
            title={t('editor.bubble.h3')}
            data-active={editor.isActive('heading', { level: 3 })}
            onClick={() => setHeading(3)}
            className={cn(BTN)}
          >
            <Heading3 className="size-4" aria-hidden />
          </button>
          {SEP}
          {/* Alignment (#275). */}
          <button
            type="button"
            aria-label={t('editor.bubble.alignLeft')}
            title={t('editor.bubble.alignLeft')}
            data-active={editor.isActive({ textAlign: 'left' })}
            onClick={() => setAlign('left')}
            className={cn(BTN)}
          >
            <AlignLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.alignCenter')}
            title={t('editor.bubble.alignCenter')}
            data-active={editor.isActive({ textAlign: 'center' })}
            onClick={() => setAlign('center')}
            className={cn(BTN)}
          >
            <AlignCenter className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.alignRight')}
            title={t('editor.bubble.alignRight')}
            data-active={editor.isActive({ textAlign: 'right' })}
            onClick={() => setAlign('right')}
            className={cn(BTN)}
          >
            <AlignRight className="size-4" aria-hidden />
          </button>
          {SEP}
          {/* Sub / superscript + inline math (#275). */}
          <button
            type="button"
            aria-label={t('editor.bubble.subscript')}
            title={t('editor.bubble.subscript')}
            data-active={editor.isActive('subscript')}
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            className={cn(BTN)}
          >
            <SubscriptIcon className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.superscript')}
            title={t('editor.bubble.superscript')}
            data-active={editor.isActive('superscript')}
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            className={cn(BTN)}
          >
            <SuperscriptIcon className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.inlineMath')}
            title={t('editor.bubble.inlineMath')}
            onClick={insertMath}
            className={cn(BTN)}
          >
            <Sigma className="size-4" aria-hidden />
          </button>
          {SEP}
          {/* Comment-on-selection (#275, ⌘⇧M). */}
          <button
            type="button"
            aria-label={t('editor.bubble.comment')}
            title={`${t('editor.bubble.comment')} (⌘⇧M)`}
            onClick={commentSelection}
            className={cn(BTN)}
          >
            <MessageSquarePlus className="size-4" aria-hidden />
          </button>
          {SEP}
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
            aria-label={t('editor.bubble.clearColor')}
            title={t('editor.bubble.clearColor')}
            onClick={() => editor.chain().focus().unsetColor().unsetHighlight().run()}
            className={cn(BTN)}
          >
            <Eraser className="size-4" aria-hidden />
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
