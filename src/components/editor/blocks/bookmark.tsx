import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import { copy } from '@/lib/copy/messages';
import { BookmarkNode } from './bookmark-node';

type Unfurl = {
  title: string | null;
  description: string | null;
  image: string | null;
  imageData: string | null;
  favicon: string | null;
};

function BookmarkView({ node, editor, updateAttributes }: NodeViewProps) {
  const url = node.attrs.url as string | null;
  const title = node.attrs.title as string | null;
  const description = node.attrs.description as string | null;
  const image = node.attrs.image as string | null;
  const imageData = node.attrs.imageData as string | null;
  const favicon = node.attrs.favicon as string | null;
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [unfurlError, setUnfurlError] = useState(false);

  async function unfurl(target: string) {
    setLoading(true);
    setUnfurlError(false);
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(target)}`);
      if (!res.ok) {
        // Non-OK (422 = could not fetch, 400 = SSRF refusal, etc.)
        // Fall back to URL-only card, and surface the error affordance so
        // the user knows the preview failed (not just "empty OG").
        // Note: if this fires on your homelab deploy, the cause is almost
        // certainly server-side egress — not a bug in this codebase. See the
        // environment note in docs/superpowers/v0.9.13/plan-d-lock-and-unfurl.md.
        setUnfurlError(true);
        updateAttributes({
          url: target,
          title: target,
          description: null,
          image: null,
          imageData: null,
          favicon: null,
        });
        return;
      }
      const meta = (await res.json()) as Unfurl;
      updateAttributes({
        url: target,
        title: meta.title ?? target,
        description: meta.description ?? null,
        image: meta.image ?? null,
        imageData: meta.imageData ?? null,
        favicon: meta.favicon ?? null,
      });
    } catch {
      setUnfurlError(true);
      updateAttributes({
        url: target,
        title: target,
        description: null,
        image: null,
        imageData: null,
        favicon: null,
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
          {(imageData ?? image) && (
            <img
              src={imageData ?? (image as string)}
              alt=""
              className="h-24 w-32 shrink-0 object-cover"
              loading="lazy"
            />
          )}
        </a>
        {unfurlError && (
          <p className="mt-1 px-3 pb-2 text-[11px] text-destructive/70">
            {copy('editor.bookmark.unfurlError')}
          </p>
        )}
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

/** Client extension: the schema-only node + its React node view. */
export const Bookmark = BookmarkNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});
