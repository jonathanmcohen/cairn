import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import { DrawioNode } from './drawio-node';

const VIEWER_ORIGIN = 'https://viewer.diagrams.net';

/**
 * Build the viewer.diagrams.net URL for either an inline XML string or a
 * publicly fetchable URL. Lightbox mode renders read-only — no toolbar, no
 * editing. When BOTH `source` and `sourceUrl` are set, the URL wins (the
 * URL contract is authoritative; the view's editor prefers fetched XML over
 * stale inlined copies).
 */
export function buildDrawioUrl(input: { source?: string; sourceUrl?: string }): string {
  const u = new URL(VIEWER_ORIGIN);
  u.searchParams.set('lightbox', '1');
  if (input.sourceUrl) {
    u.searchParams.set('url', input.sourceUrl);
    return u.toString();
  }
  if (input.source) {
    // The viewer's `data=` param accepts raw XML directly (URL-encoded by the
    // standard searchParams setter). For deflated payloads use `xml=`; this
    // viewer-only block keeps the contract simple.
    u.searchParams.set('data', input.source);
    return u.toString();
  }
  return u.toString();
}

function DrawioView({ node, editor, updateAttributes }: NodeViewProps) {
  const source = (node.attrs.source as string | undefined) ?? '';
  const sourceUrl = (node.attrs.sourceUrl as string | undefined) ?? '';
  const hasContent = Boolean(source || sourceUrl);
  const [editing, setEditing] = useState(!hasContent);
  const [draftSource, setDraftSource] = useState(source);
  const [draftUrl, setDraftUrl] = useState(sourceUrl);

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3">
        <div className="space-y-3">
          <div>
            <label
              htmlFor="cairn-drawio-xml"
              className="block text-xs font-medium text-muted-foreground"
            >
              Diagram XML
            </label>
            <textarea
              id="cairn-drawio-xml"
              value={draftSource}
              onChange={(e) => setDraftSource(e.target.value)}
              placeholder="<mxGraphModel>...</mxGraphModel>"
              className="mt-1 w-full rounded border bg-background p-2 font-mono text-sm"
              rows={6}
            />
          </div>
          <div className="text-center text-xs text-muted-foreground">— or —</div>
          <div>
            <label
              htmlFor="cairn-drawio-url"
              className="block text-xs font-medium text-muted-foreground"
            >
              Public URL
            </label>
            <input
              id="cairn-drawio-url"
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="https://example.com/diagram.drawio"
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                updateAttributes({ source: draftSource, sourceUrl: draftUrl });
                setEditing(false);
              }}
              className="rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80"
            >
              Render
            </button>
            {hasContent && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded border px-2 py-1 text-sm hover:bg-accent/40"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3">
      <iframe
        src={buildDrawioUrl({ source, sourceUrl })}
        title="drawio diagram"
        className="aspect-video w-full rounded-md border"
        // The viewer is hosted on the SAME third-party origin (viewer.diagrams.net),
        // so `allow-same-origin` only grants the iframe access to ITS OWN cookies/
        // storage at that origin, never Cairn's. `allow-popups` lets the viewer's
        // "open in drawio" link open in a new tab.
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
      {editor.isEditable && (
        <button
          type="button"
          onClick={() => {
            setDraftSource(source);
            setDraftUrl(sourceUrl);
            setEditing(true);
          }}
          className="mt-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40"
        >
          Edit diagram
        </button>
      )}
    </NodeViewWrapper>
  );
}

/** Client extension: the schema-only node + its React node view. */
export const Drawio = DrawioNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DrawioView);
  },
});
