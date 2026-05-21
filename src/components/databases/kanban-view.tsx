'use client';
import type { ViewProps } from './table-view';

export function KanbanView({ rows }: ViewProps) {
  return (
    <div className="p-2 text-sm text-muted-foreground">
      Kanban view: {rows.length} rows. (Full UI in Task 13.)
    </div>
  );
}
