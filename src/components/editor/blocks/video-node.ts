import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      /**
       * Insert a video placeholder block. Until the user uploads a file via
       * the React node-view, `fileId` and `mimeType` stay null and the node
       * renders as an upload placeholder.
       */
      setVideo: (attrs?: { fileId?: string | null; mimeType?: string | null }) => ReturnType;
    };
  }
}

/**
 * v0.8.0 P24 video node — atomic block with attrs `{fileId, mimeType}` rendered
 * as `<video controls>` whose `<source>` points at `/api/files/<id>` (the
 * existing signed-URL endpoint). The public-page render path replaces the
 * bare `src` with a fresh signed URL via `resignDocumentImages` in
 * `src/lib/pages/public.ts`. Yjs-safe (attrs only, no node-local state).
 *
 * The React node-view lives in `video.tsx` (a `.extend()` wrapper that adds
 * the upload UI); this file holds the schema-only spec so the v0.3.0 custom-
 * node Yjs audit can import it without pulling React.
 */
export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      fileId: { default: null },
      mimeType: { default: null },
      // Transient attribute: the public-page renderer fills this with a fresh
      // signed `/api/files/<id>?sig=&exp=` URL via `resignDocumentImages`
      // (src/lib/pages/public.ts). In the live editor it stays null and the
      // node falls back to the derived bare-id path. The attr is NOT persisted
      // across Yjs encode/decode by collaborators — peers regenerate signed
      // URLs at render time from their own session — but storing the post-
      // resign value here is the simplest way to give the read-only editor a
      // playable src on `/p/<slug>`.
      src: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'video[data-cairn-video]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const fileId = node.attrs.fileId as string | null;
    const mimeType = (node.attrs.mimeType as string | null) ?? 'video/mp4';
    if (!fileId) {
      // No file uploaded yet — render an inert placeholder. The public render
      // path never re-signs an empty node, so this branch is harmless there.
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          'data-cairn-video': '',
          'data-empty': '',
          class: 'my-3 rounded-md border p-3 text-sm text-muted-foreground',
        }),
        'Video pending upload',
      ];
    }
    const overrideSrc = node.attrs.src as string | null;
    const src = overrideSrc && overrideSrc.length > 0 ? overrideSrc : `/api/files/${fileId}`;
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-video': '',
        controls: 'true',
        preload: 'metadata',
        class: 'my-3 w-full',
      }),
      ['source', { src, type: mimeType }],
    ];
  },

  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              fileId: attrs?.fileId ?? null,
              mimeType: attrs?.mimeType ?? null,
            },
          }),
    };
  },
});
