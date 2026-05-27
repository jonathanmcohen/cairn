import { DateTime } from 'luxon';

/**
 * Default Luxon token-format used by the `datetime` block when no explicit
 * `display_format` attr is set. ISO-like, 24h, zero-padded — locale-stable.
 */
export const DEFAULT_DISPLAY_FORMAT = 'yyyy-LL-dd HH:mm';

/**
 * Render an ISO instant in the viewer's local tz using the supplied Luxon
 * format token string. `originalTz` is included only for context (it appears
 * in the badge — not in this function's output). Falls back to UTC if the
 * viewer's tz string is unparseable, and returns the raw ISO unchanged if
 * the ISO itself is invalid.
 *
 * v0.9.0 G3 P20.
 */
export function formatForViewer(
  iso: string,
  _originalTz: string,
  displayFormat: string,
  viewerTz: string,
): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) return iso;
  let zoned = dt.setZone(viewerTz);
  if (!zoned.isValid) zoned = dt.setZone('utc');
  return zoned.toFormat(displayFormat);
}

/**
 * Build a UTC-instant ISO string from a date+time-in-tz triple. Luxon resolves
 * DST anomalies as follows:
 *   - non-existent (spring-forward gap): the wall-clock time is shifted forward
 *     into the post-jump offset.
 *   - ambiguous (fall-back overlap): the earlier instant is chosen.
 *
 * v0.9.0 G3 P20.
 */
export function parseInput(input: { date: string; time: string; tz: string }): string {
  const dt = DateTime.fromISO(`${input.date}T${input.time}`, { zone: input.tz });
  if (!dt.isValid) {
    throw new Error(
      `invalid datetime input: ${input.date}T${input.time}@${input.tz}: ${dt.invalidReason ?? 'unknown'}`,
    );
  }
  return dt.toUTC().toISO({ suppressMilliseconds: false }) ?? `${input.date}T${input.time}:00.000Z`;
}
