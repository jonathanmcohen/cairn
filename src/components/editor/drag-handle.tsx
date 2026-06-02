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
import { blockActions } from './use-block-actions';

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

  // #271 — block mutations come from the shared `blockActions` hook so the
  // DragHandle menu and the right-click BlockContextMenu stay in lockstep.
  function action(kind: 'up' | 'down' | 'dup' | 'del') {
    if (targetPos === null) return;
    const a = blockActions(editor, targetPos);
    if (kind === 'del') a.delete();
    else if (kind === 'dup') a.duplicate();
    else if (kind === 'up') a.moveUp();
    else if (kind === 'down') a.moveDown();
    setOpen(false);
  }

  // v0.9.4 #96 — insert an empty paragraph below the hovered block and drop the
  // caret into it, so the user can immediately type `/` to open the slash menu.
  function insertBelow() {
    if (targetPos === null) return;
    blockActions(editor, targetPos).insertBelow();
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
