import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Per-database row templates. Stored in the `databases.config` jsonb under the
 * `rowTemplates` key. Each template seeds cell values (keyed by property id) and,
 * optionally, document body content for the row's page.
 *
 * NOTE: `applyRowTemplate` returns a `content` seed for future use, but the current
 * `createRow` helper accepts only `cells` — not row body content — so callers can
 * only seed cells today. The content seed is forward-looking.
 */
export const RowTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  cellDefaults: z.record(z.string(), z.unknown()).default({}),
  contentTemplate: z.unknown().optional(),
});

export type RowTemplate = {
  id: string;
  name: string;
  cellDefaults: Record<string, unknown>;
  contentTemplate?: unknown;
};

const RowTemplatesSchema = z.array(RowTemplateSchema);

type Config = Record<string, unknown>;

/** Tolerant read of `config.rowTemplates`; ignores malformed entries. */
export function listRowTemplates(config: unknown): RowTemplate[] {
  if (typeof config !== 'object' || config === null) return [];
  const raw = (config as Config).rowTemplates;
  const parsed = RowTemplatesSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Append a new template (minting an id) and return the merged config. */
export function addRowTemplate(config: unknown, template: Omit<RowTemplate, 'id'>): Config {
  const base: Config =
    typeof config === 'object' && config !== null ? { ...(config as Config) } : {};
  const existing = listRowTemplates(base);
  const next: RowTemplate = RowTemplateSchema.parse({ id: randomUUID(), ...template });
  return { ...base, rowTemplates: [...existing, next] };
}

/** Remove a template by id and return the merged config. */
export function removeRowTemplate(config: unknown, id: string): Config {
  const base: Config =
    typeof config === 'object' && config !== null ? { ...(config as Config) } : {};
  const existing = listRowTemplates(base);
  return { ...base, rowTemplates: existing.filter((t) => t.id !== id) };
}

/** Expand a template into a cell seed (+ a forward-looking content seed). */
export function applyRowTemplate(template: RowTemplate): {
  cells: Record<string, unknown>;
  content?: unknown;
} {
  return { cells: { ...template.cellDefaults }, content: template.contentTemplate };
}
