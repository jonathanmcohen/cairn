'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useState } from 'react';
import { CalendarView } from './calendar-view';
import { DatabaseExportMenu } from './export-menu';
import { GalleryView } from './gallery-view';
import { KanbanView } from './kanban-view';
import { ListView } from './list-view';
import { PropertyPanel } from './property-panel';
import { SortConfig } from './sort-config';
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
      <div className="flex items-start justify-between gap-2">
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
        <div className="flex items-center gap-2">
          <SortConfig {...viewProps} />
          <DatabaseExportMenu databaseId={databaseId} />
        </div>
      </div>
      {activeView.type === 'table' && <TableView {...viewProps} />}
      {activeView.type === 'kanban' && <KanbanView {...viewProps} />}
      {activeView.type === 'calendar' && <CalendarView {...viewProps} />}
      {activeView.type === 'timeline' && <TimelineView {...viewProps} />}
      {activeView.type === 'gallery' && <GalleryView {...viewProps} />}
      {activeView.type === 'list' && <ListView {...viewProps} />}
      <PropertyPanel databaseId={databaseId} onChange={refresh} />
    </NodeViewWrapper>
  );
}
