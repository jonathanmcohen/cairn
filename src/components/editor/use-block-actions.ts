import type { Editor } from '@tiptap/react';

/**
 * #271 — single source of truth for the block-level mutations shared by the
 * hover DragHandle menu AND the right-click BlockContextMenu. Extracted verbatim
 * from `drag-handle.tsx`'s inline `action`/`insertBelow` so the two surfaces
 * never diverge. All commands are standard ProseMirror transactions (Yjs-safe:
 * y-prosemirror syncs the structural change).
 *
 * `targetPos` is a document position *inside* the target top-level block (the
 * value DragHandle/BlockContextMenu resolve via `posAtDOM`/`posAtCoords`).
 */
export function blockActions(editor: Editor, targetPos: number) {
  function resolveBlock() {
    const { doc } = editor.state;
    const $pos = doc.resolve(targetPos);
    const blockStart = $pos.before(1);
    const blockEnd = $pos.after(1);
    const node = doc.nodeAt(blockStart);
    return { doc, blockStart, blockEnd, node };
  }

  function deleteBlock() {
    const { blockStart, blockEnd, node } = resolveBlock();
    if (!node) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.delete(blockStart, blockEnd);
        return true;
      })
      .run();
  }

  function duplicate() {
    const { blockEnd, node } = resolveBlock();
    if (!node) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insert(blockEnd, node.copy(node.content));
        return true;
      })
      .run();
  }

  function moveUp() {
    const { doc, blockStart, blockEnd, node } = resolveBlock();
    if (!node) return;
    const before = doc.childBefore(blockStart);
    const prev = before.node;
    if (!prev) return;
    const prevStart = before.offset;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.delete(blockStart, blockEnd);
        tr.insert(prevStart, node.copy(node.content));
        return true;
      })
      .run();
  }

  function moveDown() {
    const { doc, blockStart, blockEnd, node } = resolveBlock();
    if (!node) return;
    const after = doc.childAfter(blockEnd);
    const next = after.node;
    if (!next) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.delete(blockStart, blockEnd);
        const insertAt = blockEnd + next.nodeSize - node.nodeSize;
        tr.insert(insertAt, node.copy(node.content));
        return true;
      })
      .run();
  }

  function insertBelow() {
    const { schema } = editor.state;
    const { blockEnd } = resolveBlock();
    const paragraph = schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insert(blockEnd, paragraph);
        return true;
      })
      .setTextSelection(blockEnd + 1)
      .focus()
      .run();
  }

  return { moveUp, moveDown, duplicate, delete: deleteBlock, insertBelow };
}
