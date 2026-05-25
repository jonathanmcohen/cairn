import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { VideoNode } from './video-node';
import { VideoUploadButton } from './video-upload-button';

function VideoView({ node, editor, updateAttributes }: NodeViewProps) {
  const fileId = node.attrs.fileId as string | null;
  const mimeType = (node.attrs.mimeType as string | null) ?? 'video/mp4';
  // The public-render path overrides `node.attrs.src` via the
  // `resignDocumentImages` helper in src/lib/pages/public.ts. In the live
  // editor the override stays null and the source falls back to the bare
  // `/api/files/<id>` path — playback works because the upload response
  // also returned a signed URL the user can paste/share separately.
  const overrideSrc = node.attrs.src as string | null;
  const src =
    typeof overrideSrc === 'string' && overrideSrc.length > 0
      ? overrideSrc
      : `/api/files/${fileId}`;

  if (!fileId) {
    if (!editor.isEditable) {
      return (
        <NodeViewWrapper className="my-3 rounded-md border p-3 text-sm text-muted-foreground">
          Empty video.
        </NodeViewWrapper>
      );
    }
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3">
        <VideoUploadButton
          onUploaded={({ fileId: id, mimeType: mt }) =>
            updateAttributes({ fileId: id, mimeType: mt })
          }
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3">
      {/** biome-ignore lint/a11y/useMediaCaption: user-uploaded captions are out of scope for v0.8.0 P24. */}
      <video controls preload="metadata" className="w-full">
        <source src={src} type={mimeType} />
        Your browser does not support video playback.
      </video>
    </NodeViewWrapper>
  );
}

/** Client extension: the schema-only node + its React node view. */
export const VideoBlock = VideoNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },
});
