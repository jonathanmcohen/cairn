import type { Json } from './transform';

const INSERT = 'suggestionInsert';
const DELETE = 'suggestionDelete';

/** The strikethrough (`deleted`) + highlight (`inserted`) halves of one suggestion. */
export type DiffPreview = { deleted: string; inserted: string };

/**
 * Collect the deleted/inserted text of a single suggestion from a ProseMirror
 * doc JSON, in document (pre-order) order. Pure — no schema parse, no Yjs.
 * `suggestionDelete`-marked text is the original (struck through); `suggestionInsert`
 * is the proposed replacement (highlighted). Unknown ids return empty strings.
 */
export function computeDiffPreview(doc: Json, suggestionId: string): DiffPreview {
  let deleted = '';
  let inserted = '';
  const visit = (node: Json): void => {
    if (typeof node.text === 'string' && Array.isArray(node.marks)) {
      for (const m of node.marks) {
        if (m.attrs?.suggestionId !== suggestionId) continue;
        if (m.type === DELETE) deleted += node.text;
        else if (m.type === INSERT) inserted += node.text;
      }
    }
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  visit(doc);
  return { deleted, inserted };
}
