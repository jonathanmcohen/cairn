import { mergeAttributes, Node } from '@tiptap/core';

/**
 * Upload-result tuple shared by every gallery/drop caller. The drop handler in
 * `editor.tsx` and the slash-command's file-picker both produce this shape
 * from `/api/upload`'s response so `composeGalleryInsert` can stay agnostic
 * about how files are uploaded.
 */
export type ImageUploadResult = { fileId: string; src: string; alt: string };

export type GalleryInsertResult =
  | { type: 'cairnImage'; attrs: { fileId: string; src: string; alt: string } }
  | {
      type: 'gallery';
      content: Array<{
        type: 'cairnImage';
        attrs: { fileId: string; src: string; alt: string };
      }>;
    };

/**
 * Compose the TipTap insert payload for one or more image files. Used by the
 * editor's drop + paste handlers.
 *
 * - 0 image files → empty gallery (caller should skip the insert).
 * - 1 image file  → single `cairnImage` node (back-compat with pre-P16 docs).
 * - N >= 2 files  → ONE `gallery` node wrapping N `cairnImage` children.
 *
 * Non-image files are filtered out before upload, so heterogeneous drops
 * (mix of images + .txt) still produce a clean gallery of just the images.
 *
 * v0.9.0 G3 P16.
 */
export async function composeGalleryInsert(input: {
  files: File[];
  uploadFn: (file: File) => Promise<ImageUploadResult>;
}): Promise<GalleryInsertResult> {
  const imageFiles = input.files.filter((f) => f.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    return { type: 'gallery', content: [] };
  }
  const uploaded = await Promise.all(imageFiles.map(input.uploadFn));
  if (uploaded.length === 1) {
    const first = uploaded[0];
    if (!first) return { type: 'gallery', content: [] };
    return {
      type: 'cairnImage',
      attrs: { fileId: first.fileId, src: first.src, alt: first.alt },
    };
  }
  return {
    type: 'gallery',
    content: uploaded.map((u) => ({
      type: 'cairnImage' as const,
      attrs: { fileId: u.fileId, src: u.src, alt: u.alt },
    })),
  };
}

export const CairnImage = Node.create({
  name: 'cairnImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null as string | null },
      alt: { default: null as string | null },
      fileId: { default: null as string | null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-cairn-image]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-image': 'true',
        class: 'rounded-md max-w-full',
      }),
    ];
  },
  addCommands() {
    return {
      insertCairnImage:
        (attrs: { src: string; alt?: string; fileId?: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cairnImage: {
      insertCairnImage: (attrs: { src: string; alt?: string; fileId?: string }) => ReturnType;
    };
  }
}

// The client editor variant `CairnImageWithView` (atom + React node-view) lives
// in `./image-view-extension` so this module stays free of `@tiptap/react` and
// can be imported server-side (schema → suggestions transform) safely.
