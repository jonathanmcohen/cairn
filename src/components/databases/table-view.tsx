'use client';
import type { DatabaseMeta, RowData } from './use-database-data';

export type ViewProps = {
  databaseId: string;
  meta: DatabaseMeta;
  rows: RowData[];
  view: { id: string; type: string; name: string; config: unknown };
  onChange: () => void;
};

export function TableView({ meta, rows }: ViewProps) {
  return (
    <div className="p-2 text-sm text-muted-foreground">
      Table view: {meta.properties.length} properties, {rows.length} rows. (Full UI in Task 12.)
    </div>
  );
}
