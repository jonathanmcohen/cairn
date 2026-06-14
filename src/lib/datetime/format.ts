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
/**
 * Human-relative phrasing of an ISO instant ("3 days ago", "in 2 hours"),
 * locale-aware via Luxon's `toRelative`. `base` is injectable so callers/tests
 * can pin "now"; production callers omit it and get the real clock.
 *
 * Returns the raw ISO unchanged if it can't be parsed, so a bad value degrades
 * to something visible rather than throwing in a render path.
 *
 * v0.10.3 Q-6/Q-8 — trash rows show this, with the absolute timestamp on hover.
 */
export function relativeFromNow(iso: string, base?: DateTime): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  return dt.toRelative({ base: base ?? DateTime.now() }) ?? iso;
}

/**
 * Absolute, locale-formatted timestamp for the hover/title affordance that
 * accompanies a relative label — full date + time, no info loss.
 *
 * v0.10.3 Q-8.
 */
export function absoluteLocal(iso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  return dt.toLocaleString(DateTime.DATETIME_MED);
}

export function parseInput(input: { date: string; time: string; tz: string }): string {
  const dt = DateTime.fromISO(`${input.date}T${input.time}`, { zone: input.tz });
  if (!dt.isValid) {
    throw new Error(
      `invalid datetime input: ${input.date}T${input.time}@${input.tz}: ${dt.invalidReason ?? 'unknown'}`,
    );
  }
  return dt.toUTC().toISO({ suppressMilliseconds: false }) ?? `${input.date}T${input.time}:00.000Z`;
}
