import type { Editor } from '@tiptap/core';

/**
 * Compatible "turn into" targets per source block type. Only text-bearing block
 * nodes already in the schema appear here — block conversion introduces NO new
 * node types, so every conversion is an ordinary ProseMirror transaction and is
 * Yjs-safe by construction (audited in block-convert-yjs.test.ts).
 */
export const CONVERTIBLE: Record<string, readonly string[]> = {
  paragraph: ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'],
  heading: ['paragraph', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'],
  bulletList: ['orderedList', 'taskList', 'paragraph'],
  orderedList: ['bulletList', 'taskList', 'paragraph'],
  taskList: ['bulletList', 'orderedList', 'paragraph'],
  blockquote: ['paragraph'],
  codeBlock: ['paragraph'],
};

export function canConvert(from: string, to: string): boolean {
  return (CONVERTIBLE[from] ?? []).includes(to);
}

/** The block type at the current selection's head, or null. */
function currentBlockType(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  // walk up to the nearest top-level block
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.isBlock && node.type.name !== 'doc') return node.type.name;
  }
  return null;
}

/**
 * Convert the current block to `to`. Returns false (without mutating the doc) if
 * the conversion is not in the CONVERTIBLE map for the current block type. Uses
 * the TipTap chain so the change is one transaction (history/Yjs friendly).
 * `attrs` carries target-specific attributes (e.g. heading `level`).
 */
export function turnInto(editor: Editor, to: string, attrs: Record<string, unknown> = {}): boolean {
  const from = currentBlockType(editor);
  if (!from || !canConvert(from, to)) return false;

  const chain = editor.chain().focus();
  switch (to) {
    case 'heading':
      return chain.setNode('heading', attrs).run();
    case 'paragraph':
      // From a list/quote/code, lift/clear back to a plain paragraph.
      return chain.setNode('paragraph').run();
    case 'bulletList':
      return chain.toggleBulletList().run();
    case 'orderedList':
      return chain.toggleOrderedList().run();
    case 'taskList':
      return chain.toggleTaskList().run();
    case 'blockquote':
      return chain.toggleBlockquote().run();
    case 'codeBlock':
      return chain.toggleCodeBlock().run();
    default:
      return false;
  }
}
