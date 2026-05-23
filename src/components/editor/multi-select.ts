import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { turnInto } from './block-convert';

export type BlockRange = { from: number; to: number; fromIndex: number; toIndex: number };

/**
 * Resolve a span of top-level blocks (by child index, inclusive) to document
 * positions. Returns null if the indices are out of range. Operates over
 * existing nodes only — no schema change.
 */
export function blockRange(editor: Editor, fromIndex: number, toIndex: number): BlockRange | null {
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const doc = editor.state.doc;
  if (lo < 0 || hi >= doc.childCount) return null;

  let from = -1;
  let to = -1;
  doc.forEach((node, offset, index) => {
    if (index === lo) from = offset;
    if (index === hi) to = offset + node.nodeSize;
  });
  if (from < 0 || to < 0) return null;
  return { from, to, fromIndex: lo, toIndex: hi };
}

/** Set a TextSelection spanning whole blocks lo..hi (a multi-block selection). */
export function selectBlockRange(editor: Editor, fromIndex: number, toIndex: number): boolean {
  const range = blockRange(editor, fromIndex, toIndex);
  if (!range) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      const sel = TextSelection.create(tr.doc, range.from, range.to);
      if (dispatch) dispatch(tr.setSelection(sel));
      return true;
    })
    .run();
}

/** True when the current selection spans more than one whole top-level block. */
function spansMultipleBlocks(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  return $from.index(0) !== $to.index(0);
}

/**
 * Delete the selected block range. Declines (returns false) on a collapsed
 * selection or one that does not cross a whole-block boundary, so a stray
 * cursor never nukes content. Ordinary deleteSelection transaction → Yjs-safe.
 */
export function deleteBlocks(editor: Editor): boolean {
  if (!spansMultipleBlocks(editor)) return false;
  return editor.chain().focus().deleteSelection().run();
}

/**
 * Convert every block in the current multi-block selection to `to` (bulk
 * turn-into). Returns true if at least one block converted. TipTap's `setNode`/
 * `toggle*` already apply across a multi-block text selection, so this
 * delegates to `turnInto` over the current selection rather than looping
 * (which would invalidate positions).
 */
export function convertBlocks(
  editor: Editor,
  to: string,
  attrs: Record<string, unknown> = {},
): boolean {
  return turnInto(editor, to, attrs);
}
