import { TableKit } from '@tiptap/extension-table';

/**
 * A simple (non-database) table. We wrap the official @tiptap/extension-table
 * family via TableKit (Table + TableRow + TableCell + TableHeader), configured
 * for a basic table: column resizing OFF (kept simple for v0.6.0).
 *
 * Yjs-safety: the official table nodes store only cell content + structural
 * attrs (colspan/rowspan/colwidth) in ProseMirror — no node-view-local state —
 * so y-prosemirror syncs them like any block. SAFE.
 *
 * NOTE: this is distinct from the DatabaseNode (an atom referencing a Postgres
 * database by id). This table's data lives inline in the document JSON.
 */
export const SimpleTable = TableKit.configure({
  table: { resizable: false, HTMLAttributes: { class: 'cairn-table' } },
});
