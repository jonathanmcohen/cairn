import { mergeAttributes, Node } from '@tiptap/core';

/**
 * v0.9.0 G3 P18 — Citation block node.
 *
 * Atom block. Stores ALL three pre-rendered style variants in attrs (raw_*
 * fields are the source-of-truth inputs; the formatter pre-computes the strings
 * at insert time so the renderer is a pure read of the active page-level
 * style). Yjs-safe: all attrs are plain JSON, no node-local state.
 *
 * The schema-only `pubmed_id`/`raw_*` snake-case attrs match the storage shape
 * we'll persist on the API server side in P21 when the DOI/PubMed resolver
 * lands; this plan ships them as user-supplied prompts.
 */
export const CitationNode = Node.create({
  name: 'citation',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: null },
      doi: { default: null },
      pubmed_id: { default: null },
      formatted_apa: { default: '' },
      formatted_mla: { default: '' },
      formatted_chicago: { default: '' },
      raw_authors: { default: [] },
      raw_title: { default: '' },
      raw_year: { default: null },
      // v0.10.2 P5 — full CitationMeta persisted on the node at insert time so
      // the superscript chip's hover popover reads ONLY these attrs (no
      // network fetch post-insert). Nullable defaults keep pre-P5 docs parsing
      // unchanged. All plain JSON — Yjs-safe.
      journal: { default: null },
      volume: { default: null },
      issue: { default: null },
      pages: { default: null },
      url: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-citation-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-citation-id': HTMLAttributes.id ?? '',
        class: 'cairn-citation',
      }),
    ];
  },
});
