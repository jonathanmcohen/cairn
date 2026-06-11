import { z } from 'zod';
import { AUDIT_ACTIONS } from './actions';
import type { AuditFilters } from './query';

/**
 * Filter query params shared by GET /api/admin/audit (paginated viewer) and
 * GET /api/admin/audit/export (full CSV stream) — v0.10.0 D2. The list route
 * extends this with cursor/limit; the export route deliberately accepts no
 * pagination params because it always streams the complete filtered set.
 */
export const AuditFilterQuery = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: z.uuid().optional(),
  targetType: z.string().optional(),
  targetId: z.uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type AuditFilterQueryInput = z.infer<typeof AuditFilterQuery>;

/** Parsed query params → the lib-level {@link AuditFilters} shape (ISO strings → Dates). */
export function toAuditFilters(parsed: AuditFilterQueryInput): AuditFilters {
  return {
    action: parsed.action,
    actorId: parsed.actorId,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    from: parsed.from ? new Date(parsed.from) : undefined,
    to: parsed.to ? new Date(parsed.to) : undefined,
  };
}
