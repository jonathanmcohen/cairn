import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

const SelectConfig = z.object({
  options: z
    .array(z.object({ id: z.string(), name: z.string(), color: z.string().optional() }))
    .default([]),
});
const NumberConfig = z
  .object({ format: z.enum(['plain', 'currency', 'percent']).default('plain') })
  .default({ format: 'plain' });
const NoConfig = z.object({}).strict();

const ConfigByType: Record<schema.PropertyType, z.ZodTypeAny> = {
  text: NoConfig,
  number: NumberConfig,
  select: SelectConfig,
  multi_select: SelectConfig,
  date: NoConfig,
  checkbox: NoConfig,
  url: NoConfig,
};

export async function createProperty(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    databaseId: string;
    workspaceId: string;
    name: string;
    type: schema.PropertyType;
    config?: unknown;
  },
): Promise<schema.DbProperty> {
  return db.transaction(async (tx) => {
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    const config = ConfigByType[input.type].parse(input.config ?? {});
    const existing = await tx
      .select({ pos: schema.dbProperties.position })
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.databaseId, input.databaseId))
      .orderBy(schema.dbProperties.position);
    const nextPos = existing.length === 0 ? 0 : (existing[existing.length - 1]?.pos ?? -1) + 1;

    const [row] = await tx
      .insert(schema.dbProperties)
      .values({
        databaseId: input.databaseId,
        name: input.name,
        type: input.type,
        config,
        position: nextPos,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  });
}

export async function updateProperty(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    propertyId: string;
    databaseId: string;
    workspaceId: string;
    patch: { name?: string; config?: unknown };
  },
): Promise<schema.DbProperty> {
  return db.transaction(async (tx) => {
    const [prop] = await tx
      .select()
      .from(schema.dbProperties)
      .where(
        and(
          eq(schema.dbProperties.id, input.propertyId),
          eq(schema.dbProperties.databaseId, input.databaseId),
        ),
      )
      .limit(1);
    if (!prop) throw new Error('property not found');

    // Validate ownership.
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
      values.config = ConfigByType[prop.type].parse(input.patch.config);
    }
    const [updated] = await tx
      .update(schema.dbProperties)
      .set(values)
      .where(eq(schema.dbProperties.id, input.propertyId))
      .returning();
    if (!updated) throw new Error('update failed');
    return updated;
  });
}

export async function deleteProperty(
  db: PostgresJsDatabase<typeof schema>,
  input: { propertyId: string; databaseId: string; workspaceId: string },
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
      .delete(schema.dbProperties)
      .where(
        and(
          eq(schema.dbProperties.id, input.propertyId),
          eq(schema.dbProperties.databaseId, input.databaseId),
        ),
      );
  });
}
