import type { PageStatus } from '@/db/schema';

/**
 * Pure, client-safe page-status transition rules. Extracted from
 * `status.ts` (which is server-only — it imports `@/lib/audit/record`, whose
 * SIEM dispatch pulls `prom-client`'s `require('cluster')` into any client
 * bundle). The status picker (a client component) imports `canTransition`
 * from here to decide which transitions to offer.
 *
 * Allowed-transition matrix:
 *   draft     → review, archived
 *   review    → draft, published
 *   published → review, archived
 *   archived  → draft
 *
 * `published` cannot jump directly back to `draft` — it must pass through
 * `review` first (audit-trail discipline). Same-status is not allowed.
 */
const ALLOWED: Record<PageStatus, ReadonlySet<PageStatus>> = {
  draft: new Set<PageStatus>(['review', 'archived']),
  review: new Set<PageStatus>(['draft', 'published']),
  published: new Set<PageStatus>(['review', 'archived']),
  archived: new Set<PageStatus>(['draft']),
};

export function canTransition(from: PageStatus, to: PageStatus): boolean {
  return ALLOWED[from]?.has(to) ?? false;
}
