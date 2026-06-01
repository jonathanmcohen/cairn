'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { MessageSquare, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { FileComments } from '@/components/comments/file-comments';
import { useT } from '@/lib/i18n/provider';

/**
 * #139 — empty-state node-view for the `fileAttachment` atom. With an `href`
 * it renders the downloadable link card; empty + editable shows an "Upload a
 * file" picker; empty for viewers is a muted notice. The upload writes the
 * resolved attrs back via `updateAttributes` (doc/Yjs is the source of truth).
 */
export function FileView({ node, editor, updateAttributes }: NodeViewProps) {
  const t = useT();
  const href = node.attrs.href as string | null;
  const name = (node.attrs.name as string | null) ?? 'file';
  const fileId = (node.attrs.fileId as string | null) ?? null;
  const [uploading, setUploading] = useState(false);
  const [showComments, setShowComments] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return;
      const { signedUrl, file: meta } = (await res.json()) as {
        signedUrl: string;
        file: { id: string; name: string; mimeType: string; size: number };
      };
      updateAttributes({
        href: signedUrl,
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        fileId: meta.id,
      });
    } finally {
      setUploading(false);
    }
  }

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void upload(file);
    };
    input.click();
  }

  if (href) {
    return (
      <NodeViewWrapper className="my-3" data-cairn-file="">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="file-attachment inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm no-underline hover:bg-accent/30"
        >
          <Paperclip aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </a>
        {/* v0.9.7 G16 #163 — file comments are reachable once the node carries a
            resolved fileId (set on upload). The node-view has no session context,
            so we pass an empty currentUserId + a conservative editor role; the
            file-comments route re-checks requireRole server-side as the real
            authority. */}
        {fileId && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowComments((v) => !v)}
              aria-pressed={showComments}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <MessageSquare aria-hidden className="size-3.5" />
              {t('editor.file.comments')}
            </button>
            {showComments && (
              <div className="mt-2" contentEditable={false}>
                <FileComments
                  fileId={fileId}
                  canComment={editor.isEditable}
                  currentUserId=""
                  currentRole="editor"
                />
              </div>
            )}
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3 text-sm text-muted-foreground">
        {t('editor.file.emptyAlt')}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3 rounded-md border p-3" data-empty>
      <button
        type="button"
        disabled={uploading}
        onClick={pickFile}
        className="inline-flex items-center gap-2 rounded bg-accent px-2 py-1 text-sm font-medium hover:bg-accent/80 disabled:opacity-50"
      >
        <Paperclip aria-hidden className="size-4 shrink-0" />
        {uploading ? 'Uploading…' : 'Upload a file'}
      </button>
    </NodeViewWrapper>
  );
}
