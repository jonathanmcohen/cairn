'use client';

import type { Editor } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useId, useState } from 'react';
import {
  CitationAddDialog,
  type CitationStyle as DialogStyle,
} from '@/components/editor/blocks/citation-add-dialog';
import { CitationNode } from '@/components/editor/blocks/citation-node';
import type { CitationStyle } from '@/lib/citations/format';
import { numberCitations } from '@/lib/citations/numbering';
import type { CitationMeta } from '@/lib/citations/types';
import { useT } from '@/lib/i18n/provider';

type Attrs = {
  id: string | null;
  formatted_apa: string;
  formatted_mla: string;
  formatted_chicago: string;
  raw_authors: string[];
  raw_title: string;
  raw_year: number | null;
};

function pick(attrs: Attrs, style: CitationStyle): string {
  if (style === 'apa') return attrs.formatted_apa;
  if (style === 'mla') return attrs.formatted_mla;
  return attrs.formatted_chicago;
}

/**
 * v0.10.2 P5 — this citation's 1-based number among the doc's citations
 * (dedup'd by id, first-appearance order — the bibliography's order, see
 * `numberCitations`). Computed from the live editor doc the same way
 * `FootnoteSup` numbers come from `numberFootnotes` over the doc JSON.
 */
function citationNumber(editor: Editor, id: string | null): number | null {
  if (!id) return null;
  const doc = editor.getJSON() as Parameters<typeof numberCitations>[0];
  return numberCitations(doc).map[id] ?? null;
}

/**
 * v0.10.2 P5 — numbered superscript citation chip `[n]` with a hover + focus
 * popover rendered ONLY from the node's persisted attrs (no network fetch).
 * Mirrors FootnoteSup's structure: the focusable trigger is a real `<button>`
 * carrying the DPUB role (`doc-biblioref` — a reference to a bibliography
 * entry), the popover is an absolutely-positioned sibling span. Opens on
 * mouseenter AND keyboard focus; closes on mouseleave/blur/Escape (and click
 * toggles, for touch).
 */
export function CitationSup({
  number,
  authors,
  year,
  title,
  formatted,
}: {
  number: number | null;
  authors: string[];
  year: number | null;
  title: string;
  formatted: string;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const t = useT();
  const authorYearLine = [authors.join('; '), year != null ? `(${year})` : '']
    .filter(Boolean)
    .join(' ');
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouseleave here is a pointer-only hover-dismiss (covers button AND popover so moving into the popover keeps it open); the interactive element is the <button> below, which carries full keyboard parity (focus opens, blur/Escape close).
    <span className="relative inline" onMouseLeave={() => setOpen(false)}>
      <sup className="text-primary">
        <button
          type="button"
          role="doc-biblioref"
          aria-describedby={noteId}
          aria-expanded={open}
          aria-label={t('editor.citation.refLabel', { number: number ?? '?' })}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer bg-transparent p-0 leading-none text-inherit underline"
        >
          [{number ?? '?'}]
        </button>
      </sup>
      {open && (
        <span
          id={noteId}
          data-testid="citation-popover"
          className="absolute left-0 top-full z-10 mt-1 w-max max-w-sm rounded-md border bg-popover p-2 text-left text-sm font-normal shadow-md"
        >
          {authorYearLine && <span className="block font-medium">{authorYearLine}</span>}
          {title && <span className="block">{title}</span>}
          {formatted && <span className="block text-muted-foreground">{formatted}</span>}
        </span>
      )}
    </span>
  );
}

function CitationView({ node, editor, extension, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as Attrs;
  const style = (extension.options as { style: CitationStyle }).style ?? 'apa';
  const rendered = pick(attrs, style);
  const [dialogOpen, setDialogOpen] = useState(false);
  const t = useT();
  const [number, setNumber] = useState<number | null>(() => citationNumber(editor, attrs.id));

  // Re-number on every doc change (a citation inserted/removed ABOVE this one
  // shifts n). Derived-at-render from the shared doc — no node-local doc state,
  // so the node stays Yjs-safe.
  useEffect(() => {
    const recompute = () => setNumber(citationNumber(editor, attrs.id));
    recompute();
    editor.on('update', recompute);
    return () => {
      editor.off('update', recompute);
    };
  }, [editor, attrs.id]);

  const hasMeta = Boolean(rendered || attrs.raw_title);

  return (
    <NodeViewWrapper className="cairn-citation py-1" data-citation-id={attrs.id ?? ''}>
      {hasMeta ? (
        <CitationSup
          number={number}
          authors={attrs.raw_authors ?? []}
          year={attrs.raw_year ?? null}
          title={attrs.raw_title ?? ''}
          formatted={rendered}
        />
      ) : editor.isEditable ? (
        <button
          type="button"
          className="rounded border border-dashed px-2 py-1 text-muted-foreground text-sm hover:bg-muted"
          onClick={() => setDialogOpen(true)}
        >
          {t('editor.citation.addLabel')}
        </button>
      ) : null}
      {editor.isEditable && (
        <CitationAddDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          defaultStyle={style as DialogStyle}
          onInsert={(meta: CitationMeta, _formatted: string, _chosenStyle: DialogStyle) => {
            // Re-compute all three style variants from the returned meta so the
            // node-level renderer can switch styles without another lookup. The
            // dialog API only surfaces the chosen-style string; the meta itself
            // is the source of truth and is persisted in full (P5) so the chip
            // popover reads attrs only.
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
              raw_authors: meta.authors.map((a) =>
                a.given ? `${a.family}, ${a.given}` : a.family,
              ),
              raw_title: meta.title,
              raw_year: meta.year ?? null,
              // v0.10.2 P5 — persist the rest of CitationMeta on the node.
              journal: meta.journal ?? null,
              volume: meta.volume ?? null,
              issue: meta.issue ?? null,
              pages: meta.pages ?? null,
              url: meta.url ?? null,
            });
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

/**
 * v0.9.0 G3 P18 + P21, reshaped by v0.10.2 P5 — React node-view variant of the
 * Citation block. Renders a numbered superscript chip `[n]` (n = this
 * citation's 1-based order among the doc's citations — the bibliography's
 * order) instead of the full formatted string inline; the full string moved
 * into the chip's hover/focus popover alongside the author+year and title
 * lines, all read from persisted attrs.
 *
 * When the node is empty (no formatted content yet) the placeholder offers an
 * "Add citation" affordance (editable surfaces only) that opens the P21
 * CitationAddDialog. The dialog calls back with a normalized
 * {@link CitationMeta} which is persisted in full onto the node attrs.
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
