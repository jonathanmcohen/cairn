/**
 * Normalize a request pathname into a low-cardinality route TEMPLATE for use as
 * a Prometheus label. Concrete identifiers (UUIDs, long hex, numeric ids, and
 * opaque slug segments) collapse to `:id` so the metric label set stays bounded
 * regardless of how many distinct pages/rows/workspaces exist.
 *
 * CARDINALITY SAFETY (spec §2.31): the `route` label must NEVER carry a concrete
 * tenant/page/user id. This is the single chokepoint that guarantees it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const NUMERIC = /^\d+$/;
const ID_LIKE_SLUG = /\d{4,}|^[0-9a-z]{12,}$/i;

function isIdSegment(seg: string): boolean {
  return UUID.test(seg) || LONG_HEX.test(seg) || NUMERIC.test(seg) || ID_LIKE_SLUG.test(seg);
}

export function routeTemplate(rawPath: string): string {
  const path = rawPath.split('?')[0]?.split('#')[0] ?? '/';
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (trimmed === '' || trimmed === '/') return '/';
  const out = trimmed
    .split('/')
    .map((seg) => (seg !== '' && isIdSegment(seg) ? ':id' : seg))
    .join('/');
  return out === '' ? '/' : out;
}
