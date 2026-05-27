'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { CitationNode } from '@/components/editor/blocks/citation-node';
import type { CitationStyle } from '@/lib/citations/format';

type Attrs = {
  id: string | null;
  formatted_apa: string;
  formatted_mla: string;
  formatted_chicago: string;
};

function pick(attrs: Attrs, style: CitationStyle): string {
  if (style === 'apa') return attrs.formatted_apa;
  if (style === 'mla') return attrs.formatted_mla;
  return attrs.formatted_chicago;
}

function CitationView({ node, extension }: NodeViewProps) {
  const attrs = node.attrs as Attrs;
  const style = (extension.options as { style: CitationStyle }).style ?? 'apa';
  return (
    <NodeViewWrapper className="cairn-citation py-1" data-citation-id={attrs.id ?? ''}>
      {pick(attrs, style)}
    </NodeViewWrapper>
  );
}

/**
 * v0.9.0 G3 P18 — React node-view variant of the Citation block. Reads the
 * editor-level `style` option (`'apa' | 'mla' | 'chicago'`) and renders the
 * matching pre-computed `formatted_*` attr string. The plain `CitationNode` is
 * still used by `schemaExtensions()` (server-side parse path) since the React
 * view is purely presentational.
 */
export const CitationExtension = CitationNode.extend({
  addOptions() {
    return { style: 'apa' as CitationStyle };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CitationView);
  },
});

export default CitationExtension;
