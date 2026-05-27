'use client';

import { NodeViewWrapper, type NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { AudioNode } from './audio-node';

type AudioAttrs = {
  fileId: string;
  mime: string;
  name?: string | null;
  src?: string | null;
};

/**
 * v0.9.0 G3 P22 — React node-view for the `cairnAudio` block.
 *
 * Render path:
 *  - If `attrs.src` is set (public-page render via `resignDocumentImages`)
 *    use it directly — no client fetch.
 *  - Else if `attrs.fileId` is set, mint a session signed URL via
 *    `GET /api/files/<fileId>/signed-url` and render `<audio controls>`.
 *  - Else show a small inert placeholder (the bulk-uploader / slash command
 *    fill in `fileId` before insertion, so this branch is rare).
 *
 * A11y: `<audio aria-label>` carries the original filename when present.
 * The wrapper element is keyboard-selectable via TipTap's `selectable: true`
 * + `draggable: true` config in `AudioNode`.
 */
export function AudioView(props: NodeViewProps): React.JSX.Element {
  const attrs = props.node.attrs as AudioAttrs;
  const overrideSrc = attrs.src && attrs.src.length > 0 ? attrs.src : null;
  const [signedUrl, setSignedUrl] = useState<string | null>(overrideSrc);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (overrideSrc) {
      setSignedUrl(overrideSrc);
      return;
    }
    if (!attrs.fileId) return;
    const ac = new AbortController();
    fetch(`/api/files/${attrs.fileId}/signed-url`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`signed-url failed (${r.status})`);
        return (await r.json()) as { url: string };
      })
      .then((data) => {
        if (!ac.signal.aborted) setSignedUrl(data.url);
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      });
    return () => ac.abort();
  }, [attrs.fileId, overrideSrc]);

  const label = attrs.name ?? 'Audio file';

  if (!attrs.fileId) {
    return (
      <NodeViewWrapper className="my-2 rounded-md border p-3 text-muted-foreground text-sm">
        Audio pending upload
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="cairn-audio my-2" data-drag-handle>
      {error && (
        <p className="text-destructive text-sm">Audio unavailable: {error}</p>
      )}
      {signedUrl && !error ? (
        // biome-ignore lint/a11y/useMediaCaption: user-uploaded audio; captions not in scope for v0.9 P22
        <audio
          controls
          preload="metadata"
          src={signedUrl}
          aria-label={label}
          className="w-full"
        >
          <source src={signedUrl} type={attrs.mime} />
        </audio>
      ) : (
        !error && <div className="h-12 animate-pulse rounded bg-muted" />
      )}
      {attrs.name ? (
        <p className="mt-1 text-muted-foreground text-xs">{attrs.name}</p>
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * Client extension: the schema-only node + its React node view. This is the
 * lazy-loaded variant; the static `baseExtensions()` carries only `AudioNode`
 * (schema-only) so the bundle stays slim until the user actually inserts an
 * audio block (or the doc already contains one — see `nodeNamesInDoc`).
 */
export const AudioBlock = AudioNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
});

export default AudioBlock;
