'use client';

import {
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import type { Editor } from '@tiptap/react';
import { GripVertical, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

type Pos = { top: number; left: number; height: number };

export function DragHandle({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [open, setOpen] = useState(false);
  const [targetPos, setTargetPos] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const t = useT();

  // Track hovered block by listening to mousemove over the editor's DOM.
  useEffect(() => {
    const root = editor.view.dom as HTMLElement;
    function onMove(e: MouseEvent) {
      if (!root) return;
      const node = (e.target as HTMLElement)?.closest(
        '[data-node-view-wrapper], p, h1, h2, h3, ul, ol, blockquote, pre, hr, div[data-type="callout"], img[data-cairn-image], a[data-cairn-file]',
      );
      if (!node || !root.contains(node)) {
        setPos(null);
        return;
      }
      const rect = (node as HTMLElement).getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      setPos({
        top: rect.top - rootRect.top,
        // v0.9.4 #96 — widened gutter to host two 24px buttons (+ insert and
        // the drag grip) plus a 4px gap, sitting in the prose's left margin.
        left: -52,
        height: rect.height,
      });
      const dompos = editor.view.posAtDOM(node, 0);
      setTargetPos(dompos);
    }
    root.addEventListener('mousemove', onMove);
    return () => root.removeEventListener('mousemove', onMove);
  }, [editor]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    middleware: [offset(4), flip(), shift()],
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  if (!pos) return null;

  function action(kind: 'up' | 'down' | 'dup' | 'del') {
    if (targetPos === null) return;
    const { doc } = editor.state;
    const $pos = doc.resolve(targetPos);
    // The top-level block containing the resolved position.
    const blockStart = $pos.before(1);
    const blockEnd = $pos.after(1);
    const node = doc.nodeAt(blockStart);
    if (!node) return;

    if (kind === 'del') {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.delete(blockStart, blockEnd);
          return true;
        })
        .run();
    } else if (kind === 'dup') {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.insert(blockEnd, node.copy(node.content));
          return true;
        })
        .run();
    } else if (kind === 'up') {
      // Find the sibling immediately before this block at depth 1.
      const before = doc.childBefore(blockStart);
      const prev = before.node;
      if (!prev) return;
      const prevStart = before.offset;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          // Delete current block, then insert it before the previous sibling.
          tr.delete(blockStart, blockEnd);
          tr.insert(prevStart, node.copy(node.content));
          return true;
        })
        .run();
    } else if (kind === 'down') {
      // Find the sibling immediately after this block at depth 1.
      const after = doc.childAfter(blockEnd);
      const next = after.node;
      if (!next) return;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          // Delete current block first; positions after blockEnd shift left by
          // the deleted node's size. The next sibling now ends at
          // blockEnd + next.nodeSize - node.nodeSize. Insert there.
          tr.delete(blockStart, blockEnd);
          const insertAt = blockEnd + next.nodeSize - node.nodeSize;
          tr.insert(insertAt, node.copy(node.content));
          return true;
        })
        .run();
    }
    setOpen(false);
  }

  // v0.9.4 #96 — insert an empty paragraph below the hovered block and drop the
  // caret into it, so the user can immediately type `/` to open the slash menu
  // (the Task-2 placeholder paints "Type '/' for commands" there). Yjs-safe:
  // inserts a standard paragraph node + moves the selection (document structure
  // synced by y-prosemirror), never node-view-local state.
  function insertBelow() {
    if (targetPos === null) return;
    const { doc, schema } = editor.state;
    const $pos = doc.resolve(targetPos);
    const blockEnd = $pos.after(1);
    const paragraph = schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insert(blockEnd, paragraph);
        return true;
      })
      // Place the caret inside the new empty paragraph (blockEnd + 1).
      .setTextSelection(blockEnd + 1)
      .focus()
      .run();
    setOpen(false);
  }

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', top: pos.top, left: pos.left }}
      className="flex items-start gap-0.5"
    >
      <button
        type="button"
        aria-label={t('editor.insertBelow')}
        title={t('editor.insertBelow')}
        onClick={insertBelow}
        className="text-muted-foreground hover:bg-accent flex h-6 w-6 items-center justify-center rounded"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={t('editor.blockActions')}
        title={t('editor.blockActions')}
        {...getReferenceProps()}
        className="text-muted-foreground hover:bg-accent flex h-6 w-6 items-center justify-center rounded"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className="bg-popover z-30 w-40 rounded-md border py-1 text-sm shadow-md"
        >
          {[
            { kind: 'up' as const, label: 'Move up' },
            { kind: 'down' as const, label: 'Move down' },
            { kind: 'dup' as const, label: 'Duplicate' },
            { kind: 'del' as const, label: 'Delete' },
          ].map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => action(item.kind)}
              className="hover:bg-accent block w-full px-3 py-1.5 text-left"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
