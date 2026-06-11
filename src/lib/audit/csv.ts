import type { EnrichedAuditEntry } from './enrich';

/**
 * RFC-4180 CSV serializer for enriched audit-log rows (v0.10.0 D2).
 *
 * Pure + streaming-friendly: the export route emits {@link auditCsvHeader}
 * once, then {@link auditCsvRows} per keyset batch. Fields containing a
 * comma, double-quote, or newline are wrapped in double-quotes with internal
 * quotes doubled. The jsonb `metadata` column is serialized as one JSON
 * string in a single logical cell.
 *
 * Formula-injection guard: any cell whose FIRST character is `=`, `+`, `-`,
 * or `@` gets a leading `'` so a hostile value (e.g. a page titled
 * `=cmd|' /C calc'!A0`) cannot execute as a formula when the CSV is opened
 * in a spreadsheet (OWASP CSV-injection mitigation).
 */

/** Fixed export column list — one CSV column per enriched-row field. */
export const AUDIT_CSV_COLUMNS = [
  'id',
  'workspaceId',
  'createdAt',
  'action',
  'actorUserId',
  'actorName',
  'targetType',
  'targetId',
  'targetTitle',
  'targetHref',
  'ip',
  'metadata',
] as const;

export type AuditCsvColumn = (typeof AUDIT_CSV_COLUMNS)[number];

/** Spreadsheet formula-trigger characters. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);

/** RFC-4180 record delimiter. */
const CRLF = '\r\n';

/**
 * Serialize one value into a CSV field: empty for null/undefined, ISO-8601
 * for Dates, then formula-injection guard, then RFC-4180 quoting.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (s.length > 0 && FORMULA_TRIGGERS.has(s.charAt(0))) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** Header record built from {@link AUDIT_CSV_COLUMNS}, CRLF-terminated. */
export function auditCsvHeader(): string {
  return `${AUDIT_CSV_COLUMNS.join(',')}${CRLF}`;
}

function fieldFor(entry: EnrichedAuditEntry, column: AuditCsvColumn): string {
  // metadata is jsonb — serialize the whole object as ONE JSON-string cell.
  if (column === 'metadata') return csvField(JSON.stringify(entry.metadata ?? {}));
  return csvField(entry[column]);
}

/** One CRLF-terminated record per entry, in {@link AUDIT_CSV_COLUMNS} order. */
export function auditCsvRows(entries: EnrichedAuditEntry[]): string {
  return entries
    .map((entry) => `${AUDIT_CSV_COLUMNS.map((c) => fieldFor(entry, c)).join(',')}${CRLF}`)
    .join('');
}

/** Whole-document convenience (header + all rows). */
export function auditEntriesToCsv(entries: EnrichedAuditEntry[]): string {
  return `${auditCsvHeader()}${auditCsvRows(entries)}`;
}
