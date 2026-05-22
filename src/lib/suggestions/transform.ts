import { getSchema } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { liftTarget, Transform } from '@tiptap/pm/transform';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * Pure, deterministic accept/reject/preview transforms for suggestion mode.
 *
 * These operate on plain ProseMirror/TipTap doc JSON — no Yjs, no DB. A doc is
 * parsed into a real ProseMirror `Node` against the editor schema, the relevant
 * suggestion marks/nodes are resolved or removed via a `Transform`, and the
 * result is serialized back to JSON.
 *
 * Semantics (the contract):
 *  - accept insert  → remove the suggestionInsert mark, KEEP text.
 *  - reject insert  → DELETE the marked text.
 *  - accept delete  → DELETE the suggestionDelete-marked text.
 *  - reject delete  → remove the mark, KEEP text.
 *  - accept block kind=insert → unwrap (lift children out), keep content.
 *  - accept block kind=delete → remove the block.
 *  - reject inverts the block cases.
 *  - previewAccepted(doc) → accept every suggestion present (clean text).
 *  - unknown suggestionId → no-op (returns an equal doc).
 */

const INSERT = 'suggestionInsert';
const DELETE = 'suggestionDelete';
const BLOCK = 'suggestionBlock';

export type Json = {
  type: string;
  content?: Json[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
  [k: string]: unknown;
};

// Build the schema once; the suggestion extensions are part of baseExtensions().
const schema = getSchema(baseExtensions());

type Range = { from: number; to: number };

/**
 * Collect the inline ranges whose marks include `markTypeName` carrying the
 * given suggestionId. Returned high→low so positions stay valid as edits are
 * applied front-to-back without remapping.
 */
function markRanges(doc: PMNode, markTypeName: string, id: string): Range[] {
  const ranges: Range[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText && !node.isInline) return true;
    const mark = node.marks.find(
      (m) => m.type.name === markTypeName && m.attrs.suggestionId === id,
    );
    if (mark) ranges.push({ from: pos, to: pos + node.nodeSize });
    return true;
  });
  // Apply later edits from the back so earlier positions remain valid.
  return ranges.sort((a, b) => b.from - a.from);
}

/**
 * Apply any `suggestionBlock` edits for the given id. Recomputes the block
 * position from `tr.doc` immediately before each edit because earlier mark
 * edits (and prior block edits) shift positions.
 *
 * accept+insert OR reject+delete → LIFT children out (unwrap, keep content).
 * accept+delete OR reject+insert → DELETE the whole block.
 */
function findBlock(doc: PMNode, id: string): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === BLOCK && node.attrs.suggestionId === id) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
}

function applyBlock(tr: Transform, id: string, mode: 'accept' | 'reject'): void {
  // Re-scan after every edit: positions move and there may be >1 matching block.
  // Loop until no matching block remains.
  for (;;) {
    const target = findBlock(tr.doc, id);
    if (!target) return;

    const { pos, node } = target;
    const kind = node.attrs.kind === 'delete' ? 'delete' : 'insert';
    const keep =
      (mode === 'accept' && kind === 'insert') || (mode === 'reject' && kind === 'delete');

    if (keep) {
      // Unwrap: lift the block's children one level out, dropping the wrapper.
      const start = pos + 1; // inside the block
      const end = pos + node.nodeSize - 1; // before the block's closing token
      const $from = tr.doc.resolve(start);
      const $to = tr.doc.resolve(end);
      const range = $from.blockRange($to);
      const tgt = range ? liftTarget(range) : null;
      if (range && tgt != null) {
        tr.lift(range, tgt);
      } else {
        // Fallback: replace the block range with its content slice (depth 0).
        tr.replace(
          pos,
          pos + node.nodeSize,
          node.content ? node.slice(1, node.nodeSize - 1) : node.slice(0),
        );
      }
    } else {
      // Remove the whole block.
      tr.delete(pos, pos + node.nodeSize);
    }
  }
}

function acceptOn(doc: PMNode, id: string): PMNode {
  const tr = new Transform(doc);
  const insertType = schema.marks[INSERT];
  const deleteType = schema.marks[DELETE];
  // accept insert → drop the mark, keep text.
  if (insertType) {
    for (const r of markRanges(tr.doc, INSERT, id)) tr.removeMark(r.from, r.to, insertType);
  }
  // accept delete → remove the text.
  if (deleteType) {
    for (const r of markRanges(tr.doc, DELETE, id)) tr.delete(r.from, r.to);
  }
  applyBlock(tr, id, 'accept');
  return tr.doc;
}

function rejectOn(doc: PMNode, id: string): PMNode {
  const tr = new Transform(doc);
  const insertType = schema.marks[INSERT];
  const deleteType = schema.marks[DELETE];
  // reject insert → remove the inserted text.
  if (insertType) {
    for (const r of markRanges(tr.doc, INSERT, id)) tr.delete(r.from, r.to);
  }
  // reject delete → drop the mark, keep text.
  if (deleteType) {
    for (const r of markRanges(tr.doc, DELETE, id)) tr.removeMark(r.from, r.to, deleteType);
  }
  applyBlock(tr, id, 'reject');
  return tr.doc;
}

/** Accept the suggestion with the given id. Unknown ids are a no-op. */
export function acceptSuggestion(doc: Json, id: string): Json {
  const node = schema.nodeFromJSON(doc);
  return acceptOn(node, id).toJSON() as Json;
}

/** Reject the suggestion with the given id. Unknown ids are a no-op. */
export function rejectSuggestion(doc: Json, id: string): Json {
  const node = schema.nodeFromJSON(doc);
  return rejectOn(node, id).toJSON() as Json;
}

/** Every distinct suggestionId across both marks and the block node. */
function collectIds(doc: PMNode): string[] {
  const ids = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === INSERT || mark.type.name === DELETE) {
        const sid = mark.attrs.suggestionId;
        if (typeof sid === 'string') ids.add(sid);
      }
    }
    if (node.type.name === BLOCK) {
      const sid = node.attrs.suggestionId;
      if (typeof sid === 'string') ids.add(sid);
    }
    return true;
  });
  return [...ids];
}

/**
 * Resolve EVERY suggestion in the doc to its accepted state — clean text with
 * no suggestion marks or nodes remaining. Used for the public render.
 */
export function previewAccepted(doc: Json): Json {
  const node = schema.nodeFromJSON(doc);
  let result = node;
  for (const id of collectIds(node)) result = acceptOn(result, id);
  return result.toJSON() as Json;
}
