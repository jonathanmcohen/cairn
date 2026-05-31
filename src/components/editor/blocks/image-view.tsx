'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { useState } from 'react';
import { Lightbox } from '@/components/editor/lightbox';
import { useT } from '@/lib/i18n/provider';

/**
 * #139 — empty-state node-view for the `cairnImage` atom. When the node has a
 * resolved `src` it renders the image; when empty + editable it offers an
 * upload picker AND a paste-URL affordance (mirrors blocks/bookmark.tsx). For
 * viewers an empty node is a muted notice. `updateAttributes` keeps the doc /
 * Yjs state the single source of truth — no node-local persisted state.
 */
export function ImageView({ node, editor, updateAttributes }: NodeViewProps) {
  const t = useT();
  const src = node.attrs.src as string | null;
  const alt = (node.attrs.alt as string | null) ?? '';
  // An <img> with an empty `alt` is exposed as presentational (no `img` role).
  // Pass `undefined` when there's no caption so the element keeps its implicit
  // `img` role (accessibility + matches the resolved-image test).
  const altProp = alt === '' ? undefined : alt;
  const [mode, setMode] = useState<'cta' | 'url'>('cta');
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return;
      const { signedUrl, file: meta } = (await res.json()) as {
        signedUrl: string;
        file: { id: string; name: string };
      };
      updateAttributes({ src: signedUrl, alt: meta.name, fileId: meta.id });
    } finally {
      setUploading(false);
    }
  }

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void upload(file);
    };
    input.click();
  }

  if (src) {
    return (
      <NodeViewWrapper className="my-3" data-cairn-image="">
        <button
          type="button"
          aria-label={t('editor.image.openFullscreen')}
          onClick={() => setLightboxOpen(true)}
          className="block w-full cursor-zoom-in rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* biome-ignore lint/performance/noImgElement: TipTap node-view emits a raw <img>; next/image is not appropriate inside ProseMirror node views. */}
          <img src={src} alt={altProp} className="max-w-full rounded-md" loading="lazy" />
        </button>
        {lightboxOpen ? (
          <Lightbox
            images={[{ src, alt }]}
            startIndex={0}
            onClose={() => setLightboxOpen(false)}
          />
        ) : null}
      </NodeViewWrapper>
    );
  }

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3 text-sm text-muted-foreground">
        {t('editor.image.emptyAlt')}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3 rounded-md border p-3" data-empty>
      {mode === 'cta' ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={pickFile}
            className="rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload an image'}
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className="rounded border px-2 py-1 text-sm hover:bg-accent/40"
          >
            {t('editor.image.embedUrl')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('editor.image.pasteUrlPlaceholder')}
            className="flex-1 rounded border bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={url.trim().length === 0}
            onClick={() => updateAttributes({ src: url.trim(), alt: '' })}
            className="rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80 disabled:opacity-50"
          >
            {t('editor.image.embed')}
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
