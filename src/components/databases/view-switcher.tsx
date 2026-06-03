'use client';

import {
  Calendar,
  GalleryThumbnails,
  GanttChartSquare,
  Kanban,
  List,
  Plus,
  Table2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

export type ViewTab = { id: string; type: string; name: string };

type DateProp = { id: string; name: string };

const VIEW_TYPE_ICON: Record<string, typeof Table2> = {
  table: Table2,
  gallery: GalleryThumbnails,
  list: List,
  calendar: Calendar,
  timeline: GanttChartSquare,
  kanban: Kanban,
};
const ADDABLE_TYPES = ['table', 'gallery', 'list', 'calendar', 'timeline', 'kanban'] as const;
const DATE_TYPES = new Set(['calendar', 'timeline']);
// View types that require choosing a select property before creation (kanban groupBy).
const SELECT_TYPES = new Set(['kanban']);

export function ViewSwitcher({
  databaseId,
  views,
  activeId,
  dateProperties,
  selectProperties = [],
  onChange,
  onViewsChanged,
  onAddViewOptimistic,
}: {
  databaseId: string;
  views: ViewTab[];
  activeId: string;
  dateProperties: DateProp[];
  selectProperties?: DateProp[];
  onChange: (id: string) => void;
  onViewsChanged: () => void;
  /** #263 — optimistically append a temp view tab before the POST resolves. */
  onAddViewOptimistic?: (view: { id: string; type: string; name: string; config: unknown }) => void;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  // Which date-requiring type is mid-add ('calendar' | 'timeline' | null).
  const [pendingType, setPendingType] = useState<'calendar' | 'timeline' | null>(null);
  const [pickedDateProp, setPickedDateProp] = useState<string>('');
  // Kanban requires choosing a select property for its groupBy before creation.
  const [pendingKanbanProp, setPendingKanbanProp] = useState<string>('');
  const [kanbanPending, setKanbanPending] = useState(false);

  async function addSimpleView(type: 'table' | 'gallery' | 'list') {
    setAdding(true);
    // #263 — optimistic: append a temp tab + switch to it BEFORE the POST so the
    // new view is visible immediately even on a slow create / refetch.
    const name = t(`database.view.type.${type}`);
    const tempId = `tmp-${crypto.randomUUID()}`;
    onAddViewOptimistic?.({ id: tempId, type, name, config: {} });
    onChange(tempId);
    try {
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, name, config: {} }),
      });
      if (!res.ok) return; // leave error UX to a later pass; do not silently "succeed"
      const view = (await res.json()) as { id: string };
      onViewsChanged(); // background refetch reconciles the temp tab away
      onChange(view.id);
    } finally {
      setAdding(false);
    }
  }

  async function addDateView() {
    if (!pendingType || !pickedDateProp) return;
    setAdding(true);
    const name = t(`database.view.type.${pendingType}`);
    const config = { dateProperty: pickedDateProp };
    const tempId = `tmp-${crypto.randomUUID()}`;
    onAddViewOptimistic?.({ id: tempId, type: pendingType, name, config });
    onChange(tempId);
    setPendingType(null);
    setPickedDateProp('');
    try {
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: pendingType, name, config }),
      });
      if (!res.ok) return;
      const view = (await res.json()) as { id: string };
      onViewsChanged();
      onChange(view.id);
    } finally {
      setAdding(false);
    }
  }

  function startDateView(type: 'calendar' | 'timeline') {
    setPendingType(type);
    setPickedDateProp(dateProperties[0]?.id ?? '');
  }

  function startKanbanView() {
    setKanbanPending(true);
    setPendingKanbanProp(selectProperties[0]?.id ?? '');
  }

  async function addKanbanView() {
    if (!pendingKanbanProp) return;
    setAdding(true);
    const name = t('database.view.type.kanban');
    const config = { groupBy: pendingKanbanProp };
    const tempId = `tmp-${crypto.randomUUID()}`;
    onAddViewOptimistic?.({ id: tempId, type: 'kanban', name, config });
    onChange(tempId);
    setKanbanPending(false);
    setPendingKanbanProp('');
    try {
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'kanban', name, config }),
      });
      if (!res.ok) return;
      const view = (await res.json()) as { id: string };
      onViewsChanged();
      onChange(view.id);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 border-b px-2 py-1">
      <div className="flex items-center gap-1">
        {views.map((v) => {
          const Icon = VIEW_TYPE_ICON[v.type] ?? Table2;
          const active = v.id === activeId;
          return (
            <button
              key={v.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onChange(v.id)}
              className={`flex min-h-11 items-center gap-1.5 rounded px-2 py-1 text-sm ${
                active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon className="h-4 w-4 opacity-70" aria-hidden="true" />
              {v.name}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <Select
            value=""
            onValueChange={(next) => {
              if (SELECT_TYPES.has(next)) {
                startKanbanView();
              } else if (DATE_TYPES.has(next)) {
                startDateView(next as 'calendar' | 'timeline');
              } else {
                void addSimpleView(next as 'table' | 'gallery' | 'list');
              }
            }}
          >
            <SelectTrigger
              aria-label={t('database.view.add')}
              disabled={adding}
              className="h-auto min-h-11 w-auto gap-1.5 border-0 px-2 py-1 text-xs text-muted-foreground shadow-none hover:bg-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <SelectValue placeholder={t('database.view.add')} />
            </SelectTrigger>
            <SelectContent>
              {ADDABLE_TYPES.map((type) => {
                const dateDisabled = DATE_TYPES.has(type) && dateProperties.length === 0;
                const selectDisabled = SELECT_TYPES.has(type) && selectProperties.length === 0;
                const disabled = dateDisabled || selectDisabled;
                const Icon = VIEW_TYPE_ICON[type] ?? Table2;
                return (
                  <SelectItem
                    key={type}
                    value={type}
                    disabled={disabled}
                    title={
                      dateDisabled
                        ? t(`database.view.disabled.${type}`)
                        : selectDisabled
                          ? t('database.view.disabled.kanban')
                          : undefined
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="h-4 w-4 opacity-70" aria-hidden="true" />
                      {t(`database.view.type.${type}`)}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      {pendingType && (
        <div className="flex items-center gap-2 px-1 pb-1 text-xs">
          <span className="text-muted-foreground">
            {t('database.view.dateProperty', { type: pendingType })}
          </span>
          <Select value={pickedDateProp} onValueChange={(next) => setPickedDateProp(next)}>
            <SelectTrigger
              aria-label={t('database.view.dateProperty', { type: pendingType })}
              className="h-auto min-h-11 w-auto gap-1.5 px-2 py-1 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dateProperties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={adding || !pickedDateProp}
            onClick={() => void addDateView()}
            className="min-h-11"
          >
            {t('common.add')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPendingType(null)}
            className="min-h-11"
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {kanbanPending && (
        <div className="flex items-center gap-2 px-1 pb-1 text-xs">
          <span className="text-muted-foreground">{t('database.view.kanbanGroupBy')}</span>
          <Select value={pendingKanbanProp} onValueChange={(next) => setPendingKanbanProp(next)}>
            <SelectTrigger
              aria-label={t('database.view.kanbanGroupBy')}
              className="h-auto min-h-11 w-auto gap-1.5 px-2 py-1 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectProperties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={adding || !pendingKanbanProp}
            onClick={() => void addKanbanView()}
            className="min-h-11"
          >
            {t('common.add')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setKanbanPending(false)}
            className="min-h-11"
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
