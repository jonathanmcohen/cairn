import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { RelationConfig, relationTargetId } from './relations';
import { RollupConfig } from './rollup/config';

const SelectConfig = z.object({
  options: z
    .array(z.object({ id: z.string(), name: z.string(), color: z.string().optional() }))
    .default([]),
});
const NumberConfig = z
  .object({ format: z.enum(['plain', 'currency', 'percent']).default('plain') })
  .default({ format: 'plain' });
const NoConfig = z.object({}).strict();
const FormulaConfig = z.object({ expression: z.string().default('') }).default({ expression: '' });

const ConfigByType: Record<schema.PropertyType, z.ZodTypeAny> = {
  text: NoConfig,
  number: NumberConfig,
  select: SelectConfig,
  multi_select: SelectConfig,
  date: NoConfig,
  checkbox: NoConfig,
  url: NoConfig,
  formula: FormulaConfig,
  relation: RelationConfig,
  rollup: RollupConfig,
};

async function validateRollupConfig(
  tx: PostgresJsDatabase<typeof schema>,
  databaseId: string,
  config: RollupConfig,
): Promise<void> {
  // 1. relationPropertyId must be a `relation` property on THIS database.
  const [rel] = await tx
    .select({
      type: schema.dbProperties.type,
      databaseId: schema.dbProperties.databaseId,
      config: schema.dbProperties.config,
    })
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.id, config.relationPropertyId))
    .limit(1);
  if (!rel || rel.databaseId !== databaseId || rel.type !== 'relation') {
    throw new Error('rollup relationPropertyId must be a relation property on this database');
  }
  // 2. targetPropertyId must be a property on the relation's TARGET database.
  const targetDatabaseId = relationTargetId(rel.config);
  if (!targetDatabaseId) {
    throw new Error('rollup relation has no target database');
  }
  const [target] = await tx
    .select({ databaseId: schema.dbProperties.databaseId })
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.id, config.targetPropertyId))
    .limit(1);
  if (!target || target.databaseId !== targetDatabaseId) {
    throw new Error('rollup targetPropertyId must be a property on the relation target database');
  }
}

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
    if (input.type === 'relation') {
      const targetId = (config as { targetDatabaseId: string }).targetDatabaseId;
      const [target] = await tx
        .select({ workspaceId: schema.databases.workspaceId })
        .from(schema.databases)
        .where(eq(schema.databases.id, targetId))
        .limit(1);
      if (!target || target.workspaceId !== input.workspaceId) {
        throw new Error('relation target database not found in same workspace');
      }
    }
    if (input.type === 'rollup') {
      await validateRollupConfig(tx, input.databaseId, config as RollupConfig);
    }
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
      if (prop.type === 'relation') {
        const targetId = (values.config as { targetDatabaseId: string }).targetDatabaseId;
        const [target] = await tx
          .select({ workspaceId: schema.databases.workspaceId })
          .from(schema.databases)
          .where(eq(schema.databases.id, targetId))
          .limit(1);
        if (!target || target.workspaceId !== input.workspaceId) {
          throw new Error('relation target database not found in same workspace');
        }
      }
      if (prop.type === 'rollup') {
        await validateRollupConfig(tx, prop.databaseId, values.config as RollupConfig);
      }
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
