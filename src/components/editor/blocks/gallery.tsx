'use client';

import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from '@tiptap/react';
import { useState } from 'react';
import { Lightbox } from '@/components/editor/lightbox';
import { GalleryNode } from './gallery-node';

type ChildImage = { src: string; alt: string };

/**
 * Walk the gallery's `cairnImage` children and project them as `{ src, alt }`
 * tuples for the lightbox. Children with no resolved src (placeholders from
 * the `/gallery` slash command before any uploads land) are skipped — they
 * render as the "drop here" prompt instead.
 */
function extractChildren(node: ReactNodeViewProps['node']): ChildImage[] {
  const out: ChildImage[] = [];
  node.content.forEach((child) => {
    if (child.type.name !== 'cairnImage' && child.type.name !== 'image') return;
    const src = (child.attrs.src ?? child.attrs.fileId ?? '') as string;
    const alt = (child.attrs.alt ?? '') as string;
    if (src) out.push({ src, alt });
  });
  return out;
}

export function GalleryView({ node, editor }: ReactNodeViewProps) {
  const images = extractChildren(node);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Empty state: placeholder child (from `/gallery` slash insert) renders as
  // the "drop here" prompt. We still need a NodeViewContent slot so TipTap
  // can render the (placeholder) cairnImage child the schema requires.
  if (images.length === 0) {
    return (
      <NodeViewWrapper
        className="my-3 rounded-md border-2 border-dashed p-6 text-center text-sm text-muted-foreground"
        data-empty
        data-gallery=""
      >
        Drop images here or use the image button.
        <NodeViewContent className="sr-only" />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" data-gallery="">
      <ul className="grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
        {images.map((img, i) => (
          // src/fileId is unique per gallery child — TipTap allocates distinct
          // file ids per upload, so it's safe to use as the React key (no
          // array-index fallback needed).
          <li key={img.src} className="m-0 p-0">
            <button
              type="button"
              className="block aspect-square w-full overflow-hidden rounded-md focus:outline-hidden focus:ring-2 focus:ring-ring"
              onClick={() => setOpenIndex(i)}
              aria-label={`Open image ${i + 1} of ${images.length}${img.alt ? `: ${img.alt}` : ''}`}
            >
              {/* biome-ignore lint/performance/noImgElement: TipTap node-view emits a raw <img>; next/image is not appropriate inside ProseMirror node views. */}
              <img
                src={img.src}
                alt={img.alt}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          </li>
        ))}
      </ul>
      {/* TipTap still needs a hidden content slot so the underlying ProseMirror
          children stay editable (keyboard nav, copy/paste) even when the grid
          is the visible surface. */}
      <NodeViewContent className="sr-only" />
      {openIndex !== null && (
        <Lightbox images={images} startIndex={openIndex} onClose={() => setOpenIndex(null)} />
      )}
      {editor.isEditable && (
        <p className="mt-1 text-xs text-muted-foreground">
          {images.length} {images.length === 1 ? 'image' : 'images'}
        </p>
      )}
    </NodeViewWrapper>
  );
}

/** Client extension: the schema-only node + its React node view. */
export const Gallery = GalleryNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(GalleryView);
  },
});
