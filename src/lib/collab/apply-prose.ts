import * as Y from 'yjs';

/**
 * Schema-free ProseMirror-JSON → Yjs-XML writer (v0.9.15 #A3).
 *
 * The collab process (collab/server.ts) does NOT have Cairn's full TipTap
 * schema — that is browser-only (see src/lib/collab/materialize.ts). y-prosemirror's
 * `prosemirrorJSONToYDoc` goes through `Node.fromJSON(schema, json)`, which throws
 * `Unknown node type` on any custom node (callout/image/file/database/flashcard/…),
 * so it is unusable here. Instead we build the Y.XmlFragment directly from the
 * ProseMirror JSON tree, mirroring exactly the structure that y-prosemirror's
 * `yDocToProsemirrorJSON` reads back. This is schema-free: it copies whatever
 * node/mark/attr shape the JSON carries, so custom nodes round-trip faithfully.
 *
 * INVARIANTS (kept in lockstep with y-prosemirror's encoding):
 *   - text nodes  → Y.XmlText, with each PM mark applied as a Y formatting attr
 *     `{ [markType]: markAttrs }` over the whole text range;
 *   - block nodes → Y.XmlElement(nodeType), PM `attrs` copied via setAttribute,
 *     children inserted recursively;
 *   - the top-level `doc` node's children become the fragment's children (the
 *     editor binds the fragment named 'default', NOT a wrapping <doc> element).
 *
 * This is the EXACT inverse of yjsStateToProseDoc()'s reader, verified by
 * round-trip tests including a custom `callout` node + marks.
 */

type ProseMark = { type: string; attrs?: Record<string, unknown> };
type ProseNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: ProseMark[];
  content?: ProseNode[];
};

function proseTextToY(node: ProseNode): Y.XmlText {
  const text = typeof node.text === 'string' ? node.text : '';
  const ytext = new Y.XmlText();
  ytext.insert(0, text);
  if (Array.isArray(node.marks) && text.length > 0) {
    for (const mark of node.marks) {
      if (!mark || typeof mark.type !== 'string') continue;
      // y-prosemirror stores each mark as a formatting attribute keyed by the
      // mark type, value = the mark's attrs object (or {} when attr-less).
      ytext.format(0, text.length, { [mark.type]: mark.attrs ?? {} });
    }
  }
  return ytext;
}

function proseNodeToY(node: ProseNode): Y.XmlElement | Y.XmlText {
  if (node.type === 'text') return proseTextToY(node);
  const el = new Y.XmlElement(node.type);
  if (node.attrs && typeof node.attrs === 'object') {
    for (const [key, value] of Object.entries(node.attrs)) {
      // Y.XmlElement attributes are stringly-typed in the wire format but
      // y-prosemirror preserves the JSON value; setAttribute accepts any.
      el.setAttribute(key, value as never);
    }
  }
  if (Array.isArray(node.content)) {
    el.insert(0, node.content.map(proseNodeToY));
  }
  return el;
}

/**
 * Replace the contents of a bound Y.XmlFragment with the given ProseMirror-JSON
 * document. MUST be called inside a Yjs transaction (the caller controls the
 * transaction so the delete+insert is atomic and broadcast as one update).
 *
 * @param fragment The Y.XmlFragment the editor binds to (key 'default').
 * @param doc      A ProseMirror `doc` node (the value stored in pages.content).
 */
export function applyProseJsonToFragment(fragment: Y.XmlFragment, doc: unknown): void {
  const root = doc as ProseNode | null;
  const children =
    root && typeof root === 'object' && Array.isArray(root.content) ? root.content : [];
  // Clear then repopulate. The Y.XmlFragment holds the doc's *children*; the
  // top-level `doc` wrapper is implicit (the editor binds the fragment itself).
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  if (children.length > 0) {
    fragment.insert(0, children.map(proseNodeToY));
  }
}
