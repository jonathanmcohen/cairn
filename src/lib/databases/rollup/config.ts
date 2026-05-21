import { z } from 'zod';

/** Allowed rollup aggregation functions. */
export const ROLLUP_FNS = ['count', 'sum', 'avg', 'min', 'max', 'earliest', 'latest'] as const;

export type RollupFn = (typeof ROLLUP_FNS)[number];

/** A rollup aggregates `targetPropertyId` across rows reached via `relationPropertyId`. */
export const RollupConfig = z.object({
  relationPropertyId: z.uuid(),
  targetPropertyId: z.uuid(),
  fn: z.enum(ROLLUP_FNS),
});

export type RollupConfig = z.infer<typeof RollupConfig>;

/** Parse a property's config as a rollup config, or undefined if malformed. */
export function rollupConfig(config: unknown): RollupConfig | undefined {
  const parsed = RollupConfig.safeParse(config);
  return parsed.success ? parsed.data : undefined;
}
