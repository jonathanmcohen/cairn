import type { BuilderModel } from '@/lib/automation/builder';

export type BuilderTemplate = {
  id: string;
  /** i18n key for the gallery label. */
  nameKey: string;
  build: () => BuilderModel;
};

function row(
  property: string,
  operator: BuilderModel['conditions']['rows'][number]['operator'],
  value: unknown,
) {
  return { id: `c-${property}`, property, operator, value };
}

export const BUILDER_TEMPLATES: BuilderTemplate[] = [
  {
    id: 'notify-high-priority',
    nameKey: 'automation.builder.templates.notifyHighPriority',
    build: () => ({
      triggerEvent: 'row.created',
      conditions: { combinator: 'and', rows: [row('row.cells.priority', 'equals', 'High')] },
      actions: [{ id: 'a1', type: 'notify', config: {} }],
    }),
  },
  {
    id: 'auto-assign-mention',
    nameKey: 'automation.builder.templates.autoAssignMention',
    build: () => ({
      triggerEvent: 'comment.created',
      conditions: { combinator: 'and', rows: [] },
      actions: [{ id: 'a1', type: 'set_property', config: {} }],
    }),
  },
  {
    id: 'archive-on-done',
    nameKey: 'automation.builder.templates.archiveOnDone',
    build: () => ({
      triggerEvent: 'row.updated',
      conditions: { combinator: 'and', rows: [row('row.cells.status', 'equals', 'Done')] },
      actions: [{ id: 'a1', type: 'set_property', config: {} }],
    }),
  },
];
