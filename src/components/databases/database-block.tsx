'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

export function DatabaseBlock({ node }: NodeViewProps) {
  const databaseId = (node.attrs as { databaseId?: string }).databaseId;
  return (
    <NodeViewWrapper className="my-4 rounded-md border p-4 text-sm text-muted-foreground">
      {databaseId ? `Database ${databaseId} — views land in Tasks 11-15.` : 'Database not found'}
    </NodeViewWrapper>
  );
}
