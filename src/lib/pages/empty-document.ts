// Minimal valid ProseMirror document for a fresh page.
export type ProseMirrorDoc = {
  type: 'doc';
  content?: Array<Record<string, unknown>>;
};

export function emptyDocument(): ProseMirrorDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}
