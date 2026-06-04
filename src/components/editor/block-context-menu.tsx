'use client';

import type { Editor } from '@tiptap/react';
import { ContextMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { headingSlug } from '@/lib/editor/headings';
import { useT } from '@/lib/i18n/provider';
import { turnInto } from './block-convert';
import { blockActions } from './use-block-actions';

const ITEM =
  'flex min-h-9 w-full cursor-pointer items-center rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground';

/**
 * #271 — right-click context menu for editor blocks. Mirrors the sidebar's
 * `page-row-context-menu.tsx` (radix `ContextMenu`, keyboard-accessible). Block
 * mutations come from the shared `blockActions` hook (single source of truth
 * with the DragHandle). Mutating items are gated on `editable`; read-only
 * viewers still get the non-mutating Comment + Copy-link.
 */
export function BlockContextMenu({
  editor,
  targetPos,
  pageId,
  editable = true,
  children,
}: {
  editor: Editor;
  targetPos: number;
  pageId: string;
  editable?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const a = blockActions(editor, targetPos);

  function blockNode() {
    const { doc } = editor.state;
    const $pos = doc.resolve(targetPos);
    return doc.nodeAt($pos.before(1));
  }

  function selectBlock() {
    // Place the selection inside the target block so Comment/Color act on it.
    editor.chain().setTextSelection(targetPos).focus().run();
  }

  function comment() {
    selectBlock();
    window.dispatchEvent(new CustomEvent('cairn:editor:comment-selection'));
  }

  function color() {
    selectBlock();
    if (editor.isActive('highlight')) editor.chain().focus().unsetHighlight().run();
    else editor.chain().focus().toggleHighlight({ color: '#fde68a' }).run();
  }

  function convert() {
    const node = blockNode();
    if (!node) return;
    // Toggle paragraph <-> heading(2) as a minimal convert affordance.
    if (node.type.name === 'heading') turnInto(editor, 'paragraph');
    else turnInto(editor, 'heading', { level: 2 });
  }

  function copyLink() {
    const node = blockNode();
    const anchor =
      node?.type.name === 'heading' ? headingSlug(node.textContent) : `block-${targetPos}`;
    const origin = typeof location !== 'undefined' ? location.origin : '';
    void navigator.clipboard?.writeText(`${origin}/pages/${pageId}#${anchor}`);
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {editable && (
            <>
              <ContextMenu.Item className={ITEM} onSelect={() => a.duplicate()}>
                {t('editor.block.duplicate')}
              </ContextMenu.Item>
              <ContextMenu.Item className={ITEM} onSelect={() => a.delete()}>
                {t('editor.block.delete')}
              </ContextMenu.Item>
              <ContextMenu.Item className={ITEM} onSelect={() => a.moveUp()}>
                {t('editor.block.moveUp')}
              </ContextMenu.Item>
              <ContextMenu.Item className={ITEM} onSelect={() => a.moveDown()}>
                {t('editor.block.moveDown')}
              </ContextMenu.Item>
              <ContextMenu.Item className={ITEM} onSelect={() => convert()}>
                {t('editor.block.convert')}
              </ContextMenu.Item>
              <ContextMenu.Item className={ITEM} onSelect={() => color()}>
                {t('editor.block.color')}
              </ContextMenu.Item>
              <ContextMenu.Separator className="-mx-1 my-1 h-px bg-muted" />
            </>
          )}
          <ContextMenu.Item className={ITEM} onSelect={() => comment()}>
            {t('editor.block.comment')}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => copyLink()}>
            {t('editor.block.copyLink')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
