import type { TriggerEvent } from '@/lib/automation/events';

const SAMPLE_PAGE = {
  id: '00000000-0000-0000-0000-0000000000a1',
  title: 'Sample page',
  workspaceId: '00000000-0000-0000-0000-0000000000ff',
};

const SAMPLE_ROW = {
  id: '00000000-0000-0000-0000-0000000000b1',
  databaseId: '00000000-0000-0000-0000-0000000000c1',
  cells: { status: 'Done', priority: 'High', assignee: null },
};

const SAMPLE_COMMENT = {
  id: '00000000-0000-0000-0000-0000000000d1',
  body: 'Looks good to me!',
  authorId: '00000000-0000-0000-0000-0000000000e1',
};

/**
 * Deterministic sample trigger payload for the "Test rule" dry-run, keyed by
 * trigger event. Shapes mirror the webhook event payloads `evaluateRules`
 * receives in production so dotted-path conditions (e.g. row.cells.status)
 * resolve the same way.
 */
export function samplePayloadFor(event: TriggerEvent): Record<string, unknown> {
  switch (event) {
    case 'page.created':
    case 'page.updated':
    case 'page.deleted':
      return { event, page: { ...SAMPLE_PAGE } };
    case 'row.created':
    case 'row.updated':
    case 'row.deleted':
      return { event, row: { ...SAMPLE_ROW, cells: { ...SAMPLE_ROW.cells } } };
    case 'comment.created':
      return { event, comment: { ...SAMPLE_COMMENT }, page: { ...SAMPLE_PAGE } };
    default:
      return { event };
  }
}
