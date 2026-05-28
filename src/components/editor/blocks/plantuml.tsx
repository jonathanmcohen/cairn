import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { PlantUmlNode } from './plantuml-node';

/**
 * Build a PlantUML render URL given a (browser-encoded) source string. The
 * deflate+base64 encoder ships in the `plantuml-encoder` npm package and is
 * lazy-loaded by the React view at render time, so callers pass `encode` in.
 *
 * Exported separately for unit testing — the test stubs `encodeFn` so it can
 * assert the URL shape without pulling pako into the test environment.
 */
export function buildPlantUmlUrl(
  source: string,
  server: string | undefined,
  encodeFn: (s: string) => string,
): string {
  const base = (server ?? 'https://www.plantuml.com/plantuml').replace(/\/+$/, '');
  return `${base}/svg/${encodeFn(source)}`;
}

export function PlantUmlView({ node, editor, updateAttributes }: NodeViewProps) {
  const source = (node.attrs.source as string | undefined) ?? '';
  // v0.9.0 G3 P15 review fix — encrypted-page leak guard. The page-detail shell
  // stamps `editor.storage.cairn.encrypted` (see editor.tsx). PlantUML encodes
  // the source into a URL fetched from www.plantuml.com (or CAIRN_PLANTUML_SERVER),
  // which would ship DECRYPTED diagram text to a 3rd-party server on an E2E
  // page. Fail-closed: anything that isn't strictly `false` is treated as
  // encrypted (mirrors `src/lib/webhooks/payload.ts`).
  const encrypted =
    (editor.storage as { cairn?: { encrypted?: boolean } }).cairn?.encrypted === true;
  const [editing, setEditing] = useState(!source);
  const [draft, setDraft] = useState(source);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!source || encrypted) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    // Lazy-load `plantuml-encoder` so the editor bundle stays slim (only paid
    // when a page actually has a PlantUML block).
    void import('plantuml-encoder')
      .then((mod) => {
        if (cancelled) return;
        try {
          const server = process.env.NEXT_PUBLIC_CAIRN_PLANTUML_SERVER as string | undefined;
          setUrl(buildPlantUmlUrl(source, server, mod.default.encode));
          setErr(null);
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'PlantUML encode failed');
          setUrl(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'PlantUML encoder failed to load');
        setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source, encrypted]);

  if (encrypted) {
    return (
      <NodeViewWrapper className="my-3">
        <div
          className="rounded-md border border-muted p-3 text-sm text-muted-foreground"
          data-encrypted-placeholder="plantuml"
        >
          Diagram rendering disabled on encrypted pages (would expose source to external server).
        </div>
      </NodeViewWrapper>
    );
  }

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'@startuml\nAlice -> Bob: hello\n@enduml'}
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
          PlantUML error: {err}
        </div>
      )}
      {url && (
        // PlantUML renders as a plain <img>; the public/self-hosted server
        // emits SVG/PNG bytes. No iframe → no CSP `frame-src` entry needed
        // (`img-src https:` already permits the public server).
        // `referrerPolicy="no-referrer"` prevents leaking the Cairn page URL
        // (which may itself contain workspace/page ids) to the diagram server;
        // `crossOrigin="anonymous"` opts the fetch into CORS so no credentials
        // are sent and the response can be inspected if needed.
        // biome-ignore lint/performance/noImgElement: TipTap node-view emits a raw <img>; next/image is not appropriate inside ProseMirror node views.
        <img
          src={url}
          alt="PlantUML diagram"
          className="max-w-full overflow-x-auto"
          loading="lazy"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
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
export const PlantUml = PlantUmlNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PlantUmlView);
  },
});
