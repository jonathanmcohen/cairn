'use client';

import { type ReactNode, useRef, useState } from 'react';
import { useLongPress } from '@/components/mobile/long-press';
import { useActionAllowed } from '@/components/pwa/offline-context';
import type { CalcFn } from '@/lib/databases/calc-footer';
import { groupRows } from '@/lib/databases/group';
import { applyRowTemplate, listRowTemplates } from '@/lib/databases/row-templates';
import { CalcFooterRow } from './calc-footer-row';
import { CellEditor } from './cell-editor';
import { columnLayout } from './column-ergonomics';
import { buildRowForest, flattenVisible } from './row-tree';
import type { DatabaseMeta, RowData } from './use-database-data';
import { VirtualizedRowBody } from './virtualized-row-body';

export type ViewProps = {
  databaseId: string;
  meta: DatabaseMeta;
  rows: RowData[];
  view: { id: string; type: string; name: string; config: unknown };
  onChange: () => void;
};

/**
 * <tr> with a long-press → context-menu sheet (mobile users get Delete /
 * Duplicate / Open without the right-click affordance). Sheet anchors to the
 * row via `position: absolute` and dismisses on outside click.
 */
function LongPressRow({
  databaseId,
  rowId,
  onChange,
  className,
  children,
}: {
  databaseId: string;
  rowId: string;
  onChange: () => void;
  className?: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useLongPress(rowRef, { onLongPress: () => setMenuOpen(true) });

  async function onDelete() {
    setMenuOpen(false);
    if (!window.confirm('Delete this row?')) return;
    await fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: 'DELETE' });
    onChange();
  }

  async function onDuplicate() {
    setMenuOpen(false);
    // Reuse the bulk-create endpoint shape: POST /rows with no body creates a
    // blank row. A true "duplicate" would copy cells; defer to a future plan
    // (the API doesn't expose a single-row clone today).
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    onChange();
  }

  return (
    <tr ref={rowRef} className={className} style={{ position: 'relative' }}>
      {children}
      {menuOpen ? (
        <td
          aria-hidden="true"
          style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, padding: 0 }}
        >
          <div
            role="dialog"
            aria-label="Row actions"
            className="w-44 rounded-md border bg-popover py-1 shadow-md"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => void onDuplicate()}
            >
              Duplicate row
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
              onClick={() => void onDelete()}
            >
              Delete row
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

export function TableView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const [adding, setAdding] = useState(false);
  const rowMutateAllowed = useActionAllowed('db-row-mutate');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const config = (view.config ?? {}) as {
    groupBy?: string | null;
    calcFooter?: Record<string, CalcFn>;
    columnWidths?: Record<string, number>;
    frozenColumnIds?: string[];
    hiddenColumnIds?: string[];
  };
  const calcFooter = config.calcFooter ?? {};
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);
  const grouped = groupByProp?.type === 'select';

  const columns = columnLayout(meta.properties, {
    columnWidths: config.columnWidths ?? {},
    frozenColumnIds: config.frozenColumnIds ?? [],
    hiddenColumnIds: config.hiddenColumnIds ?? [],
  });

  const templates = listRowTemplates(meta.database.config);

  async function addRow(parentRowId?: string) {
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parentRowId ? { parentRowId } : {}),
    });
    setAdding(false);
    onChange();
  }

  async function addRowFromTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    // applyRowTemplate also returns a `content` seed, but createRow only accepts
    // `cells` today — so only the cell defaults are wired.
    const { cells } = applyRowTemplate(template);
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cells }),
    });
    setAdding(false);
    onChange();
  }

  function rowTr(r: RowData) {
    return (
      <LongPressRow
        key={r.row.id}
        databaseId={databaseId}
        rowId={r.row.id}
        onChange={onChange}
        className="border-b hover:bg-accent/40"
      >
        {columns.map((c) => {
          const stickyStyle =
            c.frozen && c.insetInlineStart !== null
              ? {
                  position: 'sticky' as const,
                  insetInlineStart: `${c.insetInlineStart}px`,
                  zIndex: 1,
                }
              : undefined;
          return (
            <td
              key={c.id}
              style={stickyStyle}
              className={c.frozen ? 'bg-card px-3 py-2.5' : 'px-3 py-2.5'}
            >
              <CellEditor
                databaseId={databaseId}
                rowId={r.row.id}
                property={c.prop}
                value={r.cells[c.id]}
                onSaved={onChange}
              />
            </td>
          );
        })}
      </LongPressRow>
    );
  }

  let body: React.ReactNode;
  if (grouped && groupByProp) {
    const options =
      (groupByProp.config as { options?: { id: string; name: string }[] })?.options ?? [];
    const groups = groupRows(rows, groupByProp.id, options);
    body = groups.map((g) => (
      <tbody key={g.id || 'uncategorized'}>
        <tr className="border-b bg-muted/40">
          <td
            colSpan={columns.length}
            className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {g.name} · {g.rows.length}
          </td>
        </tr>
        {g.rows.map((r) => rowTr(r))}
      </tbody>
    ));
  } else {
    const rowById = new Map(rows.map((r) => [r.row.id, r]));
    const forest = buildRowForest(
      rows.map((r) => ({ id: r.row.id, parentRowId: r.row.parentRowId })),
    );
    const visible = flattenVisible(forest, collapsed);
    // The non-grouped path delegates to <VirtualizedRowBody>, which renders its
    // own sticky header + windowed rows. Cell rendering, frozen-column logic,
    // and per-row toggle/add-child handlers map 1:1 from the previous <tbody>
    // (see virtualized-row-body.tsx). The grouped path is unchanged because
    // groups are usually < 100 rows — virtualization isn't worth the complexity.
    body = (
      <VirtualizedRowBody
        columns={columns}
        visible={visible}
        rowDataById={rowById}
        collapsed={collapsed}
        databaseId={databaseId}
        onToggle={toggle}
        onChange={onChange}
        onAddChild={(parentId) => void addRow(parentId)}
        adding={adding}
      />
    );
  }

  // The grouped path keeps the original <table>/<thead>/<tbody>/<tfoot> shape
  // because <CalcFooterRow> is a <tfoot> and must live inside a <table>. The
  // non-grouped path renders <VirtualizedRowBody> (which contains its own
  // header) plus a separate single-row <table> just for the calc footer — this
  // way windowed rows don't fight table layout, but the footer still works.
  return (
    <div className="-mx-1 sm:mx-0">
      {grouped ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <colgroup>
              {columns.map((c) => (
                <col key={c.id} style={{ width: `${c.width}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b">
                {columns.map((c) => {
                  const stickyStyle =
                    c.frozen && c.insetInlineStart !== null
                      ? {
                          position: 'sticky' as const,
                          insetInlineStart: `${c.insetInlineStart}px`,
                          zIndex: 1,
                        }
                      : undefined;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      style={stickyStyle}
                      className={
                        c.frozen
                          ? 'bg-card px-3 py-2 text-left font-medium'
                          : 'px-3 py-2 text-left font-medium'
                      }
                    >
                      {c.prop.name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {body}
            <CalcFooterRow
              databaseId={databaseId}
              viewId={view.id}
              viewConfig={view.config}
              meta={meta}
              rows={rows}
              calcFooter={calcFooter}
              onChange={onChange}
            />
          </table>
        </div>
      ) : (
        <>
          {rows.length === 0 ? (
            // a10 #19 — render the column header row even with zero rows so an
            // empty database still reads as a table (Notion-parity), then show
            // the empty-state hint in the body. Without this the block
            // collapsed to a bare "No rows yet." with no column context.
            <div className="overflow-x-auto">
              {/* biome-ignore lint/a11y/useSemanticElements: matches the div-based ARIA grid header used by <VirtualizedRowBody>; a <table> cannot host the windowed body, so the empty header mirrors that shape for consistency. */}
              <div role="grid">
                {/* biome-ignore lint/a11y/useFocusableInteractive: header row is a screen-reader landmark; columns carry no sort/resize handles yet, so tabIndex would only confuse focus order. */}
                {/* biome-ignore lint/a11y/useSemanticElements: <tr> requires a parent <table>; this header mirrors the div-based ARIA grid in <VirtualizedRowBody> so the empty and populated states share one shape. */}
                <div
                  data-virtual-header
                  className="flex bg-card text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  role="row"
                >
                  {columns.map((c) => (
                    // biome-ignore lint/a11y/useFocusableInteractive: columnheader is a landmark role, not user-interactive here.
                    // biome-ignore lint/a11y/useSemanticElements: <th> is forbidden outside a <table>; this header lives in a div-based ARIA grid.
                    <div
                      key={c.id}
                      role="columnheader"
                      className="border-b px-3 py-2"
                      style={{
                        width: c.width,
                        minWidth: c.width,
                        ...(c.frozen && c.insetInlineStart !== null
                          ? {
                              position: 'sticky',
                              insetInlineStart: `${c.insetInlineStart}px`,
                              zIndex: 3,
                              background: 'inherit',
                            }
                          : null),
                      }}
                    >
                      {c.prop.name}
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No rows yet — add one with + New row.
              </div>
            </div>
          ) : (
            <div className="h-[600px] min-h-0">{body}</div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <colgroup>
                {columns.map((c) => (
                  <col key={c.id} style={{ width: `${c.width}px` }} />
                ))}
              </colgroup>
              <CalcFooterRow
                databaseId={databaseId}
                viewId={view.id}
                viewConfig={view.config}
                meta={meta}
                rows={rows}
                calcFooter={calcFooter}
                onChange={onChange}
              />
            </table>
          </div>
        </>
      )}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => void addRow()}
          disabled={adding || !rowMutateAllowed}
          title={rowMutateAllowed ? undefined : 'Unavailable offline'}
          className="flex-1 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
        >
          + New row
        </button>
        {templates.length > 0 && (
          <select
            aria-label="New row from template"
            value=""
            disabled={adding || !rowMutateAllowed}
            title={rowMutateAllowed ? undefined : 'Unavailable offline'}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void addRowFromTemplate(id);
            }}
            className="px-2 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <option value="">Templates…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
