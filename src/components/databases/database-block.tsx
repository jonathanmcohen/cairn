'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useState } from 'react';
import { GalleryView } from './gallery-view';
import { KanbanView } from './kanban-view';
import { TableView } from './table-view';
import { useDatabaseData } from './use-database-data';
import { ViewSwitcher } from './view-switcher';

export function DatabaseBlock({ node }: NodeViewProps) {
  const databaseId = (node.attrs as { databaseId?: string }).databaseId ?? '';
  const [viewId, setViewId] = useState<string | null>(null);
  const { meta, rows, loading, refresh } = useDatabaseData(databaseId, viewId);

  if (!databaseId || !meta) {
    return (
      <NodeViewWrapper className="my-4 rounded-md border p-4 text-sm text-muted-foreground">
        {loading ? 'Loading database…' : 'Database not found'}
      </NodeViewWrapper>
    );
  }

  const activeView = meta.views.find((v) => v.id === viewId) ?? meta.views[0];
  if (!activeView) {
    return (
      <NodeViewWrapper className="my-4 rounded-md border p-4 text-sm text-muted-foreground">
        No views configured.
      </NodeViewWrapper>
    );
  }

  const viewProps = { databaseId, meta, rows, view: activeView, onChange: refresh };

  return (
    <NodeViewWrapper className="my-4 rounded-md border" contentEditable={false}>
      <ViewSwitcher views={meta.views} activeId={activeView.id} onChange={setViewId} />
      {activeView.type === 'table' && <TableView {...viewProps} />}
      {activeView.type === 'kanban' && <KanbanView {...viewProps} />}
      {activeView.type === 'gallery' && <GalleryView {...viewProps} />}
    </NodeViewWrapper>
  );
}
