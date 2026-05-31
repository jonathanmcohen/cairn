'use client';

import { useState } from 'react';
import { CalendarView } from './calendar-view';
import { DatabaseExportMenu } from './export-menu';
import { FiltersConfig } from './filters-config';
import { GalleryView } from './gallery-view';
import { KanbanView } from './kanban-view';
import { ListView } from './list-view';
import { PropertyPanel } from './property-panel';
import { SortConfig } from './sort-config';
import { TableView } from './table-view';
import { TimelineView } from './timeline-view';
import { useDatabaseData } from './use-database-data';
import { ViewSwitcher } from './view-switcher';

/**
 * Full-page render mode over a database. Mirrors the per-view dispatch in
 * `database-block.tsx` but at page-body width, with the database name as an
 * `<h1>`. Reusable; the caller wires the route/page.
 */
export function FullPageDatabase({ databaseId }: { databaseId: string }) {
  const [viewId, setViewId] = useState<string | null>(null);
  const { meta, rows, loading, refresh } = useDatabaseData(databaseId, viewId);

  if (!databaseId || !meta) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">
        {loading ? 'Loading database…' : 'Database not found'}
      </div>
    );
  }

  const activeView = meta.views.find((v) => v.id === viewId) ?? meta.views[0];
  if (!activeView) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">
        No views configured.
      </div>
    );
  }

  const viewProps = { databaseId, meta, rows, view: activeView, onChange: refresh };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-4 text-2xl font-semibold">{meta.database.name}</h1>
      <div className="rounded-md border">
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
            <FiltersConfig {...viewProps} />
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
      </div>
    </div>
  );
}
