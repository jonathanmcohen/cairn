import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cairnAudio: {
      /**
       * Insert an audio node carrying the given uploaded `fileId` + MIME type.
       * Used by the slash menu's `/audio` entry and the bulk-upload completion
       * path (v0.9.0 G3 P22). When called with no args, inserts an empty
       * placeholder — the React node-view shows an upload picker.
       */
      setAudio: (attrs?: { fileId?: string; mime?: string; name?: string | null }) => ReturnType;
    };
  }
}

/**
 * v0.9.0 G3 P22 — `cairnAudio` block node.
 *
 * Attrs:
 *  - `fileId` — the uploaded `files.id`. Empty string until a file is chosen
 *               (mirrors the upload-picker pattern; reduces nullable noise in
 *               the renderer).
 *  - `mime`   — one of `audio/{mpeg,wav,ogg,flac,aac}`. Defaults to
 *               `audio/mpeg`. Used as the `<source type="…">` hint.
 *  - `name`   — optional original filename (display caption only). Null when
 *               omitted.
 *  - `src`    — TRANSIENT: the public-page renderer (`resignDocumentImages`
 *               in `src/lib/pages/public.ts`) fills this with a fresh signed
 *               `/api/files/<id>?sig=&exp=` URL. In the live editor it stays
 *               null and the React view fetches a signed URL on mount.
 *               Yjs-safe: peers may carry it but each session re-derives.
 *
 * All attrs are plain JSON values, so y-prosemirror syncs them losslessly
 * (Yjs-SAFE; no node-local mutable state).
 *
 * The React node-view (`AudioView` in `audio-view.tsx`) is wired by the
 * `AudioBlock` export below; this file stays React-free so server-side
 * schema parsing in `schema.ts` can import it without pulling in React.
 */
export const AudioNode = Node.create({
  name: 'cairnAudio',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      fileId: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-file-id') ?? '',
        renderHTML: (attrs) => ({ 'data-file-id': String(attrs.fileId ?? '') }),
      },
      mime: {
        default: 'audio/mpeg',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-mime') ?? 'audio/mpeg',
        renderHTML: (attrs) => ({ 'data-mime': String(attrs.mime ?? 'audio/mpeg') }),
      },
      name: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-name'),
        renderHTML: (attrs) => (attrs.name ? { 'data-name': String(attrs.name) } : {}),
      },
      // Transient: filled by `resignDocumentImages` on the public-page render
      // path. The live editor leaves this null and the React view fetches
      // a fresh signed URL via `/api/files/<id>/signed-url` on mount.
      src: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-cairn-audio]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-cairn-audio': '' })];
  },

  addCommands() {
    return {
      setAudio:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              fileId: attrs?.fileId ?? '',
              mime: attrs?.mime ?? 'audio/mpeg',
              name: attrs?.name ?? null,
            },
          }),
    };
  },
});
