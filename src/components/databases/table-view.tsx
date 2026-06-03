'use client';

import { Maximize2, MessageSquare, Plus } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useLongPress } from '@/components/mobile/long-press';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CalcFn } from '@/lib/databases/calc-footer';
import { groupRows } from '@/lib/databases/group';
import { applyRowTemplate, listRowTemplates } from '@/lib/databases/row-templates';
import { useT } from '@/lib/i18n/provider';
import { CalcFooterRow } from './calc-footer-row';
import { CellEditor } from './cell-editor';
import { columnLayout } from './column-ergonomics';
import { RowDetailPanel } from './row-detail-panel';
import { RowPeekPanel } from './row-peek-panel';
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
  rowId,
  onDelete,
  onDuplicate,
  className,
  children,
}: {
  rowId: string;
  // v0.9.9 F3 #245 — handlers lifted into TableView (shared with the gutter
  // menu). They take the rowId so the same body works for any row.
  onDelete: (rowId: string) => void;
  onDuplicate: (rowId: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useLongPress(rowRef, { onLongPress: () => setMenuOpen(true) });

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
              onClick={() => {
                setMenuOpen(false);
                onDuplicate(rowId);
              }}
            >
              Duplicate row
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
              onClick={() => {
                setMenuOpen(false);
                onDelete(rowId);
              }}
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
  const t = useT();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const rowMutateAllowed = useActionAllowed('db-row-mutate');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // G16 #163 — the row currently open in the peek/comments panel (null = closed).
  const [peekRowId, setPeekRowId] = useState<string | null>(null);
  // v0.9.9 F1 #241 — the row currently open in the full row-detail drawer.
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
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

  // v0.9.9 F3 #245 — row delete/duplicate lifted here so both the left-gutter
  // ⋮⋮ menu (VirtualizedRowBody / grouped rowTr) and the mobile long-press sheet
  // share one implementation.
  async function deleteRow(rowId: string) {
    const ok = await confirm({
      title: t('db.row.delete'),
      confirmLabel: t('db.row.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    await fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: 'DELETE' });
    onChange();
  }

  async function duplicateRow(_rowId: string) {
    // The API has no single-row clone yet; POST with no body creates a blank
    // row (mirrors the prior long-press behavior). A true cell-copy duplicate
    // is deferred to a follow-up.
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    onChange();
  }

  function rowTr(r: RowData) {
    return (
      <LongPressRow
        key={r.row.id}
        rowId={r.row.id}
        onDelete={(id) => void deleteRow(id)}
        onDuplicate={(id) => void duplicateRow(id)}
        className="group border-b hover:bg-accent/40"
      >
        {columns.map((c, i) => {
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
              <span className="inline-flex items-center gap-1">
                {i === 0 && (
                  <>
                    {/* v0.9.9 F1 #241 — open the full row-detail drawer. */}
                    <button
                      type="button"
                      aria-label={t('databases.rowDetail.open')}
                      onClick={() => setDetailRowId(r.row.id)}
                      className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <Maximize2 className="size-3.5" aria-hidden />
                    </button>
                    {/* G16 #163 — open the row peek panel (comments thread). */}
                    <button
                      type="button"
                      aria-label={t('databases.row.peek')}
                      onClick={() => setPeekRowId(r.row.id)}
                      className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <MessageSquare className="size-4" aria-hidden />
                    </button>
                  </>
                )}
                <CellEditor
                  databaseId={databaseId}
                  rowId={r.row.id}
                  property={c.prop}
                  value={r.cells[c.id]}
                  onSaved={onChange}
                />
              </span>
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
        onOpenDetail={(rowId) => setDetailRowId(rowId)}
        onDeleteRow={(rowId) => void deleteRow(rowId)}
        onDuplicateRow={(rowId) => void duplicateRow(rowId)}
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
            // a10 #19 — keep the column header row even with zero rows so an
            // empty database still reads as a table (Notion-parity).
            // #144 — lead with the row-count indicator + a single emphasised
            // "Add your first row" CTA; the old centered emptyHint and the
            // redundant top "Add row" button are removed to cut dead space.
            <div>
              <div className="flex items-center px-3 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {t('database.rowCount', { count: rows.length })}
                </span>
              </div>
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
              </div>
              <div className="px-3 py-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void addRow()}
                  disabled={adding || !rowMutateAllowed}
                  title={rowMutateAllowed ? undefined : 'Unavailable offline'}
                  className="min-h-11"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('database.empty.firstRow')}
                </Button>
              </div>
            </div>
          ) : (
            // #39/#218 — size to content up to a max height instead of always
            // reserving 600px (which left dead vertical space for short tables).
            <div className="max-h-[600px] min-h-0">{body}</div>
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
          aria-label={t('database.addRow')}
          title={rowMutateAllowed ? undefined : 'Unavailable offline'}
          className="flex flex-1 items-center gap-1.5 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('database.newRow')}
        </button>
        {templates.length > 0 && (
          <Select
            value="__none"
            disabled={adding || !rowMutateAllowed}
            onValueChange={(id) => {
              if (id && id !== '__none') void addRowFromTemplate(id);
            }}
          >
            <SelectTrigger
              aria-label="New row from template"
              title={rowMutateAllowed ? undefined : 'Unavailable offline'}
              className="w-auto border-0 px-2 py-2 text-sm text-muted-foreground shadow-none hover:bg-accent"
            >
              <SelectValue placeholder="Templates…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Templates…</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {/* G16 #163 — row peek panel hosting the (previously unreachable)
          RowComments thread. TableView has no viewer-context props; the comment
          routes re-check requireRole server-side as the authority, so we pass a
          conservative editor role + empty userId here. */}
      {peekRowId && (
        <RowPeekPanel
          databaseId={databaseId}
          rowId={peekRowId}
          open={peekRowId !== null}
          onOpenChange={(o) => {
            if (!o) setPeekRowId(null);
          }}
          canComment
          currentUserId=""
          currentRole="editor"
        />
      )}
      {/* v0.9.9 F1 #241 — full row-detail drawer (properties + body + comments).
          Like RowPeekPanel, TableView has no viewer-context props; the row routes
          re-check requireRole server-side, so a conservative editor role + empty
          userId is passed here. */}
      {detailRowId && (
        <RowDetailPanel
          databaseId={databaseId}
          rowId={detailRowId}
          meta={meta}
          open={detailRowId !== null}
          onOpenChange={(o) => {
            if (!o) setDetailRowId(null);
          }}
          refresh={onChange}
          canComment
          currentUserId=""
          currentRole="editor"
        />
      )}
    </div>
  );
}
