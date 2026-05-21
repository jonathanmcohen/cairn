import { z } from 'zod';

/** A relation property points at exactly one target database (same workspace, validated separately). */
export const RelationConfig = z.object({
  targetDatabaseId: z.uuid(),
});

export type RelationConfig = z.infer<typeof RelationConfig>;

/** A relation cell value is a list of related db_rows ids. */
export const RelationCellValue = z.array(z.uuid());

/** Read a property's targetDatabaseId, or undefined if the config is malformed. */
export function relationTargetId(config: unknown): string | undefined {
  const parsed = RelationConfig.safeParse(config);
  return parsed.success ? parsed.data.targetDatabaseId : undefined;
}
