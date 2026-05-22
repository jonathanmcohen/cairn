import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { TemplatePayload } from './payload';

type Db = PostgresJsDatabase<typeof schema>;

function doc(...blocks: unknown[]) {
  return { type: 'doc', content: blocks };
}
function heading(text: string) {
  return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] };
}
function para(text = '') {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}

/** Source ids here are arbitrary placeholders; instantiate remaps them. */
const BUILTINS: { name: string; kind: 'page' | 'database'; payload: TemplatePayload }[] = [
  {
    name: 'Meeting notes',
    kind: 'page',
    payload: {
      kind: 'page',
      rootPageId: 'mn-root',
      pages: [
        {
          id: 'mn-root',
          parentId: null,
          title: 'Meeting notes',
          icon: '📝',
          content: doc(
            heading('Attendees'),
            para(),
            heading('Agenda'),
            para(),
            heading('Action items'),
            para(),
          ),
        },
      ],
      databases: [],
    },
  },
  {
    name: 'Weekly planner',
    kind: 'page',
    payload: {
      kind: 'page',
      rootPageId: 'wp-root',
      pages: [
        {
          id: 'wp-root',
          parentId: null,
          title: 'Weekly planner',
          icon: '🗓️',
          content: doc(
            heading('This week'),
            para(),
            heading('Goals'),
            para(),
            heading('Notes'),
            para(),
          ),
        },
      ],
      databases: [],
    },
  },
  {
    name: 'Project tracker',
    kind: 'database',
    payload: {
      kind: 'database',
      rootDatabaseId: 'pt-db',
      pages: [],
      databases: [
        {
          id: 'pt-db',
          name: 'Project tracker',
          properties: [
            { id: 'pt-name', name: 'Task', type: 'text', config: {}, position: 0 },
            {
              id: 'pt-status',
              name: 'Status',
              type: 'select',
              config: {
                options: [
                  { id: 'pt-todo', name: 'To do', color: 'gray' },
                  { id: 'pt-doing', name: 'In progress', color: 'blue' },
                  { id: 'pt-done', name: 'Done', color: 'green' },
                ],
              },
              position: 1,
            },
            { id: 'pt-due', name: 'Due', type: 'date', config: {}, position: 2 },
          ],
          views: [
            {
              id: 'pt-table',
              type: 'table',
              name: 'All tasks',
              config: {
                visibleProperties: ['pt-name', 'pt-status', 'pt-due'],
                sorts: [],
                filters: [],
                groupBy: null,
              },
              position: 0,
            },
            {
              id: 'pt-board',
              type: 'kanban',
              name: 'Board',
              config: {
                visibleProperties: ['pt-name', 'pt-due'],
                sorts: [],
                filters: [],
                groupBy: 'pt-status',
              },
              position: 1,
            },
          ],
          rows: [],
        },
      ],
    },
  },
];

/**
 * Upsert global built-in templates idempotently keyed by (name, built_in=true,
 * workspace_id IS NULL). Safe to run at every startup.
 */
export async function seedBuiltinTemplates(db: Db): Promise<void> {
  for (const b of BUILTINS) {
    const [existing] = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.name, b.name),
          eq(schema.templates.builtIn, true),
          isNull(schema.templates.workspaceId),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(schema.templates)
        .set({ kind: b.kind, payload: b.payload })
        .where(eq(schema.templates.id, existing.id));
    } else {
      await db.insert(schema.templates).values({
        workspaceId: null,
        name: b.name,
        kind: b.kind,
        payload: b.payload,
        builtIn: true,
      });
    }
  }
}
