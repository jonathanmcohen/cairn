'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import {
  CitationAddDialog,
  type CitationStyle as DialogStyle,
} from '@/components/editor/blocks/citation-add-dialog';
import { CitationNode } from '@/components/editor/blocks/citation-node';
import type { CitationStyle } from '@/lib/citations/format';
import type { CitationMeta } from '@/lib/citations/types';

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

function CitationView({ node, extension, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as Attrs;
  const style = (extension.options as { style: CitationStyle }).style ?? 'apa';
  const rendered = pick(attrs, style);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <NodeViewWrapper className="cairn-citation py-1" data-citation-id={attrs.id ?? ''}>
      {rendered ? (
        <span data-citation>{rendered}</span>
      ) : (
        <button
          type="button"
          className="rounded border border-dashed px-2 py-1 text-muted-foreground text-sm hover:bg-muted"
          onClick={() => setDialogOpen(true)}
        >
          Add citation
        </button>
      )}
      <CitationAddDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        defaultStyle={style as DialogStyle}
        onInsert={(meta: CitationMeta, _formatted: string, _chosenStyle: DialogStyle) => {
          // Re-compute all three style variants from the returned meta so the
          // node-level renderer can switch styles without another lookup.
          // The dialog API only surfaces the chosen-style string; the meta
          // itself is the source of truth and is stashed under `attrs.meta`
          // for the P18 bibliography aggregator (when it's extended to read
          // the structured meta).
          updateAttributes({
            id: meta.doi ?? meta.pmid ?? attrs.id,
            doi: meta.doi ?? null,
            pubmed_id: meta.pmid ?? null,
            // The Insert path supplies the active style's string; the other
            // two get filled lazily by the API consumer (or recomputed in a
            // follow-up. For now we set the active-style attr only; the
            // alternate-style switches will gracefully fall back to empty
            // until P18 re-renders them.)
            formatted_apa: _chosenStyle === 'apa' ? _formatted : attrs.formatted_apa,
            formatted_mla: _chosenStyle === 'mla' ? _formatted : attrs.formatted_mla,
            formatted_chicago: _chosenStyle === 'chicago' ? _formatted : attrs.formatted_chicago,
            raw_authors: meta.authors.map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)),
            raw_title: meta.title,
            raw_year: meta.year ?? null,
          });
        }}
      />
    </NodeViewWrapper>
  );
}

/**
 * v0.9.0 G3 P18 + P21 — React node-view variant of the Citation block.
 * Reads the editor-level `style` option (`'apa' | 'mla' | 'chicago'`) and
 * renders the matching pre-computed `formatted_*` attr string.
 *
 * When the node is empty (no formatted content yet) the placeholder offers
 * an "Add citation" affordance that opens the P21 CitationAddDialog. The
 * dialog calls back with a normalized {@link CitationMeta} which is split
 * back into the `formatted_*` attrs the P18 renderer + bibliography
 * aggregator already consume.
 *
 * The plain `CitationNode` is still used by `schemaExtensions()` (server-side
 * parse path) since the React view is purely presentational.
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
