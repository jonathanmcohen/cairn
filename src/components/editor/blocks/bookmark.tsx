import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (url: string) => ReturnType;
    };
  }
}

type Unfurl = {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
};

function BookmarkView({ node, editor, updateAttributes }: NodeViewProps) {
  const url = node.attrs.url as string | null;
  const title = node.attrs.title as string | null;
  const description = node.attrs.description as string | null;
  const image = node.attrs.image as string | null;
  const favicon = node.attrs.favicon as string | null;
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);

  async function unfurl(target: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(target)}`);
      const meta = (res.ok ? await res.json() : {}) as Unfurl;
      updateAttributes({
        url: target,
        title: meta.title ?? target,
        description: meta.description ?? null,
        image: meta.image ?? null,
        favicon: meta.favicon ?? null,
      });
    } finally {
      setLoading(false);
    }
  }

  if (url) {
    return (
      <NodeViewWrapper className="my-3">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex overflow-hidden rounded-md border no-underline hover:bg-accent/30"
        >
          <div className="flex flex-1 flex-col gap-1 p-3">
            <span className="line-clamp-1 text-sm font-medium text-foreground">{title ?? url}</span>
            {description && (
              <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
            )}
            <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              {favicon && <img src={favicon} alt="" className="h-3 w-3" />}
              <span className="line-clamp-1">{new URL(url).hostname}</span>
            </span>
          </div>
          {image && (
            <img src={image} alt="" className="h-24 w-32 shrink-0 object-cover" loading="lazy" />
          )}
        </a>
      </NodeViewWrapper>
    );
  }

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3 text-sm text-muted-foreground">
        Empty bookmark.
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a link to bookmark"
          className="flex-1 rounded border bg-background px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={loading || draft.trim().length === 0}
          onClick={() => void unfurl(draft.trim())}
          className="rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Bookmark'}
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: null },
      title: { default: null },
      description: { default: null },
      image: { default: null },
      favicon: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark-url]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-bookmark-url': HTMLAttributes.url })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },

  addCommands() {
    return {
      setBookmark:
        () =>
        ({ commands }) =>
          // Insert empty; the node-view immediately unfurls once the user confirms.
          // (The URL is unfurled client-side so the cached metadata lands in attrs.)
          commands.insertContent({ type: this.name, attrs: { url: null } }),
    };
  },
});
