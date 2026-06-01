'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical } from 'lucide-react';
import { ActionCardHost } from '@/components/automation/builder/action-card-host';
import { FlowConnector } from '@/components/automation/builder/flow-connector';
import { Button } from '@/components/ui/button';
import type * as schema from '@/db/schema';
import type { ActionCard } from '@/lib/automation/builder';
import { useT } from '@/lib/i18n/provider';

type Props = {
  actions: ActionCard[];
  onChange: (next: ActionCard[]) => void;
};

function SortableAction({
  action,
  isLast,
  onConfig,
  onMoveDown,
}: {
  action: ActionCard;
  isLast: boolean;
  onConfig: (next: { type: schema.AutomationActionType; config: Record<string, unknown> }) => void;
  onMoveDown: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: action.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}>
      <FlowConnector variant="branch" />
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={t('automation.builder.dragAction')}
          className="mt-2 cursor-grab touch-none text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <ActionCardHost type={action.type} config={action.config} onChange={onConfig} />
        </div>
        {!isLast ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('automation.builder.moveActionDown')}
            onClick={onMoveDown}
          >
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ActionList({ actions, onChange }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = actions.findIndex((a) => a.id === active.id);
    const to = actions.findIndex((a) => a.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(actions, from, to));
  }

  function setConfigAt(
    index: number,
    next: { type: schema.AutomationActionType; config: Record<string, unknown> },
  ) {
    onChange(actions.map((a, i) => (i === index ? { ...a, ...next } : a)));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={actions.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        {actions.map((action, i) => (
          <SortableAction
            key={action.id}
            action={action}
            isLast={i === actions.length - 1}
            onConfig={(next) => setConfigAt(i, next)}
            onMoveDown={() => onChange(arrayMove(actions, i, i + 1))}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
