import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';

const ViewConfigSchema = z.object({
  sorts: z
    .array(
      z.object({
        propertyId: z.uuid(),
        direction: z.enum(['asc', 'desc']),
      }),
    )
    .default([]),
  filters: z
    .array(
      z.object({
        propertyId: z.uuid(),
        op: z.string(),
        value: z.unknown(),
      }),
    )
    .default([]),
  groupBy: z.uuid().nullable().default(null),
  dateProperty: z.uuid().nullable().default(null),
  startProperty: z.uuid().nullable().default(null),
  endProperty: z.uuid().nullable().default(null),
  visibleProperties: z.array(z.uuid()).default([]),
});

export type ViewConfig = z.infer<typeof ViewConfigSchema>;

function assertViewConfig(type: schema.ViewType, config: ViewConfig): void {
  if (type === 'kanban' && !config.groupBy) {
    throw new Error('kanban view requires groupBy');
  }
  if (type === 'calendar' && !config.dateProperty) {
    throw new Error('calendar view requires a dateProperty');
  }
  if (
    type === 'timeline' &&
    !config.dateProperty &&
    !(config.startProperty && config.endProperty)
  ) {
    throw new Error('timeline view requires a dateProperty or a startProperty+endProperty pair');
  }
  // 'list' has no required config — grouping (groupBy) and multi-sort (sorts) are optional.
  if (type === 'list') return;
}

export type CreateViewInput = {
  databaseId: string;
  workspaceId: string;
  type: schema.ViewType;
  name: string;
  config?: unknown;
};

export async function createView(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateViewInput,
): Promise<schema.DbView> {
  return db.transaction(async (tx) => {
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    const config = ViewConfigSchema.parse(input.config ?? {});
    assertViewConfig(input.type, config);
    const existing = await tx
      .select({ pos: schema.dbViews.position })
      .from(schema.dbViews)
      .where(eq(schema.dbViews.databaseId, input.databaseId))
      .orderBy(schema.dbViews.position);
    const nextPos = existing.length === 0 ? 0 : (existing[existing.length - 1]?.pos ?? -1) + 1;

    const [view] = await tx
      .insert(schema.dbViews)
      .values({
        databaseId: input.databaseId,
        type: input.type,
        name: input.name,
        config,
        position: nextPos,
      })
      .returning();
    if (!view) throw new Error('insert view failed');
    return view;
  });
}

export async function updateView(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    viewId: string;
    databaseId: string;
    workspaceId: string;
    patch: { name?: string; config?: unknown };
  },
): Promise<schema.DbView> {
  return db.transaction(async (tx) => {
    const [view] = await tx
      .select()
      .from(schema.dbViews)
      .where(
        and(eq(schema.dbViews.id, input.viewId), eq(schema.dbViews.databaseId, input.databaseId)),
      )
      .limit(1);
    if (!view) throw new Error('view not found');

    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }

    const values: { name?: string; config?: unknown } = {};
    if (input.patch.name !== undefined) values.name = input.patch.name;
    if (input.patch.config !== undefined) {
      const config = ViewConfigSchema.parse(input.patch.config);
      assertViewConfig(view.type, config);
      values.config = config;
    }
    const [updated] = await tx
      .update(schema.dbViews)
      .set(values)
      .where(eq(schema.dbViews.id, input.viewId))
      .returning();
    if (!updated) throw new Error('update failed');
    return updated;
  });
}

export async function deleteView(
  db: PostgresJsDatabase<typeof schema>,
  input: { viewId: string; databaseId: string; workspaceId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    await tx
      .delete(schema.dbViews)
      .where(
        and(eq(schema.dbViews.id, input.viewId), eq(schema.dbViews.databaseId, input.databaseId)),
      );
  });
}
