import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import { resolveEmbed } from '@/lib/editor/embed-allowlist';
import { EmbedNode } from './embed-node';

function EmbedView({ node, editor, updateAttributes }: NodeViewProps) {
  const provider = node.attrs.provider as string | null;
  const src = node.attrs.src as string | null;
  const [draft, setDraft] = useState('');

  if (src && provider) {
    return (
      <NodeViewWrapper className="my-3" data-embed-provider={provider}>
        <div
          className="relative w-full overflow-hidden rounded-md border"
          style={{ aspectRatio: '16 / 9' }}
        >
          <iframe
            src={src}
            title={`${provider} embed`}
            className="absolute inset-0 h-full w-full"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
            loading="lazy"
            allow="fullscreen; clipboard-write; encrypted-media"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3 text-sm text-muted-foreground">
        Empty embed.
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a YouTube, Vimeo, Figma, gist, or CodeSandbox URL"
          className="flex-1 rounded border bg-background px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            const resolved = resolveEmbed(draft.trim());
            if (resolved) updateAttributes({ provider: resolved.provider, src: resolved.src });
          }}
          className="rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80"
        >
          Embed
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Only allowlisted providers can be embedded.
      </p>
    </NodeViewWrapper>
  );
}

/** Client extension: the schema-only node + its React node view. */
export const Embed = EmbedNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
