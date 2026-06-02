import type { AutomationOperator } from '@/db/schema';
import type { BuilderModel } from '@/lib/automation/builder';

export type BuilderTemplate = {
  id: string;
  /** i18n key for the gallery label. */
  nameKey: string;
  /** i18n key for the gallery description (searchable). */
  descKey: string;
  build: () => BuilderModel;
};

function leaf(field: string, op: AutomationOperator, value: unknown) {
  return { id: `c-${field}`, field, op, value };
}

export const BUILDER_TEMPLATES: BuilderTemplate[] = [
  {
    id: 'notify-high-priority',
    nameKey: 'automation.builder.templates.notifyHighPriority',
    descKey: 'automation.builder.templates.notifyHighPriorityDesc',
    build: () => ({
      triggerEvent: 'row.created',
      conditions: {
        id: 'g',
        logic: 'and',
        children: [leaf('row.cells.priority', 'equals', 'High')],
      },
      actions: [{ id: 'a1', type: 'notify', config: {} }],
    }),
  },
  {
    id: 'auto-assign-mention',
    nameKey: 'automation.builder.templates.autoAssignMention',
    descKey: 'automation.builder.templates.autoAssignMentionDesc',
    build: () => ({
      triggerEvent: 'comment.created',
      conditions: { id: 'g', logic: 'and', children: [] },
      actions: [{ id: 'a1', type: 'set_property', config: {} }],
    }),
  },
  {
    id: 'archive-on-done',
    nameKey: 'automation.builder.templates.archiveOnDone',
    descKey: 'automation.builder.templates.archiveOnDoneDesc',
    build: () => ({
      triggerEvent: 'row.updated',
      conditions: {
        id: 'g',
        logic: 'and',
        children: [leaf('row.cells.status', 'equals', 'Done')],
      },
      actions: [{ id: 'a1', type: 'set_property', config: {} }],
    }),
  },
];
