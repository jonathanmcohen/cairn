import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import { resolveEmbed } from '@/lib/editor/embed-allowlist';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** Insert an embed from a pasted URL; no-op if the URL is not allowlisted. */
      setEmbed: (rawUrl: string) => ReturnType;
    };
  }
}

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

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      provider: { default: null },
      src: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed-provider]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-embed-provider': HTMLAttributes.provider }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },

  addCommands() {
    return {
      setEmbed:
        (rawUrl) =>
        ({ commands }) => {
          const resolved = resolveEmbed(rawUrl);
          if (!resolved) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { provider: resolved.provider, src: resolved.src },
          });
        },
    };
  },
});
