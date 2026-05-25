import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useId, useState } from 'react';
import { MermaidNode } from './mermaid-node';

function MermaidView({ node, editor, updateAttributes }: NodeViewProps) {
  const source = (node.attrs.source as string | undefined) ?? '';
  const [editing, setEditing] = useState(!source);
  const [draft, setDraft] = useState(source);
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    // Lazy-load `mermaid` so the editor bundle stays slim (only paid when a
    // page actually has a Mermaid block).
    void import('mermaid').then((m) => {
      try {
        m.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
      } catch {
        /* re-init is safe but throws on some hot-reload paths; ignore */
      }
      m.default
        .render(`mermaid-${id}`, source)
        .then((r) => {
          if (cancelled) return;
          setSvg(r.svg);
          setErr(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setErr(e instanceof Error ? e.message : 'Mermaid render failed');
          setSvg(null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'graph TD;\n  A-->B;'}
          className="w-full rounded border bg-background p-2 font-mono text-sm"
          rows={6}
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              updateAttributes({ source: draft });
              setEditing(false);
            }}
            className="rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80"
          >
            Render
          </button>
          {source && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border px-2 py-1 text-sm hover:bg-accent/40"
            >
              Cancel
            </button>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3">
      {err && (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Mermaid error: {err}
        </div>
      )}
      {svg && (
        <div
          className="overflow-x-auto"
          // SVG is the deterministic output of mermaid.render with
          // securityLevel: 'strict' — no foreign HTML, no <script>.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted Mermaid SVG (securityLevel 'strict').
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {editor.isEditable && (
        <button
          type="button"
          onClick={() => {
            setDraft(source);
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
export const Mermaid = MermaidNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
