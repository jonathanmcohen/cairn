import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import type { Editor, NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { createElement } from 'react';
import { SyncedBlockNode } from './synced-block-node';

/**
 * Serialize the source node's child content to HTML for a live read-only
 * projection. The node-view re-renders on every transaction in the shared Yjs
 * doc, so this stays in sync with the source as it is edited.
 */
function serializeContent(editor: Editor, source: PMNode): string {
  const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(source.content);
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
}

/**
 * Find the FIRST syncedBlock with the given id in the document. If that first
 * occurrence is this node (pos === selfPos) we are the source (return null);
 * otherwise we are a mirror of `{ node, pos }`. Same-page only — never reaches
 * across documents.
 */
function findSource(
  doc: PMNode,
  id: string | null,
  selfPos: number,
): { node: PMNode; pos: number } | null {
  if (id == null) return null;
  let first: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (first) return false;
    if (node.type.name === 'syncedBlock' && node.attrs.syncedBlockId === id) {
      first = { node, pos };
      return false;
    }
    return true;
  });
  const found = first as { node: PMNode; pos: number } | null;
  if (!found) return null;
  if (found.pos === selfPos) return null; // I am the source.
  return found; // I am a mirror.
}

function SyncedBlockView({ node, editor, getPos }: NodeViewProps) {
  const id = node.attrs.syncedBlockId as string | null;
  const selfPos = typeof getPos === 'function' ? (getPos() ?? -1) : -1;
  const source = findSource(editor.state.doc, id, selfPos);

  if (source) {
    return createElement(
      NodeViewWrapper,
      { className: 'my-2 rounded-md border border-dashed bg-muted/20 p-3' },
      createElement(
        'div',
        { className: 'mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground' },
        'Synced (mirror)',
      ),
      createElement('div', {
        className: 'prose-sm pointer-events-none select-text',
        // biome-ignore lint/security/noDangerouslySetInnerHtml: serialized from the local trusted doc.
        dangerouslySetInnerHTML: { __html: serializeContent(editor, source.node) },
      }),
      createElement(
        'div',
        { className: 'mt-2 text-[11px] text-muted-foreground' },
        'Mirror of a synced block above. Edit the source to change both.',
      ),
    );
  }

  return createElement(
    NodeViewWrapper,
    { className: 'my-2 rounded-md border-l-2 border-primary/50 bg-primary/5 pl-3' },
    createElement(
      'div',
      { className: 'mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground' },
      'Synced',
    ),
    createElement(NodeViewContent),
  );
}

/** Client extension: the schema-only node + its React node view. */
export const SyncedBlock = SyncedBlockNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockView);
  },
});
