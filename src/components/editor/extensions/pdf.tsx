'use client';

import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import { lazy, Suspense } from 'react';
import { PdfNode } from '@/components/editor/blocks/pdf-node';

/**
 * Lazy-loaded TipTap extension for the `pdf` block (v0.9.0 G3 P17).
 *
 * Heavy work — `pdfjs-dist` + the worker chunk + the canvas/SVG overlay —
 * lives behind a React.lazy() boundary inside the NodeView, so importing this
 * file only pulls in TipTap + the schema-only PdfNode. The lazy import does
 * NOT run on the server (renderer is `'use client'`).
 *
 * The mounted page-id is plumbed through `window.__cairnPageId` by the host
 * editor (set in `editor.tsx` when the page mounts) so the renderer can POST
 * new annotations without having to walk the TipTap node tree.
 */

const PdfRenderer = lazy(() => import('./pdf-renderer'));

function PdfNodeView({ node, editor }: ReactNodeViewProps) {
  const fileId = (node.attrs.fileId as string | null) ?? null;
  const defaultPage = (node.attrs.defaultPage as number | undefined) ?? 1;

  // v0.9 G3 P15/P16 carry the encrypted flag on the editor; mirror that here
  // so an E2E page never opens an in-line PDF (the signed-URL endpoint also
  // refuses, but the UI should reflect the state instead of showing an error).
  const cairn = (editor.storage as { cairn?: { pageId?: string; encrypted?: boolean } }).cairn;
  const encrypted = cairn?.encrypted === true;
  const pageId = cairn?.pageId ?? null;

  if (encrypted) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border border-muted p-3 text-sm text-muted-foreground">
        Inline PDFs are not rendered on encrypted pages.
      </NodeViewWrapper>
    );
  }

  if (!fileId) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Empty PDF block. Drop a `.pdf` file or use the slash command.
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <Suspense
        fallback={
          <div className="my-3 rounded-md border p-4 text-sm text-muted-foreground">
            Loading PDF…
          </div>
        }
      >
        <PdfRenderer fileId={fileId} defaultPage={defaultPage} pageId={pageId} />
      </Suspense>
    </NodeViewWrapper>
  );
}

const Pdf = PdfNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PdfNodeView);
  },
});

export { Pdf as default };
