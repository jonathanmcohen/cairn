'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useState } from 'react';
import { CalendarView } from './calendar-view';
import { GalleryView } from './gallery-view';
import { KanbanView } from './kanban-view';
import { PropertyPanel } from './property-panel';
import { TableView } from './table-view';
import { TimelineView } from './timeline-view';
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
      <ViewSwitcher
        databaseId={databaseId}
        views={meta.views}
        activeId={activeView.id}
        dateProperties={meta.properties
          .filter((p) => p.type === 'date')
          .map((p) => ({ id: p.id, name: p.name }))}
        onChange={setViewId}
        onViewsChanged={refresh}
      />
      {activeView.type === 'table' && <TableView {...viewProps} />}
      {activeView.type === 'kanban' && <KanbanView {...viewProps} />}
      {activeView.type === 'calendar' && <CalendarView {...viewProps} />}
      {activeView.type === 'timeline' && <TimelineView {...viewProps} />}
      {activeView.type === 'gallery' && <GalleryView {...viewProps} />}
      <PropertyPanel databaseId={databaseId} onChange={refresh} />
    </NodeViewWrapper>
  );
}
