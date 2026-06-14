import type { ManageCard } from './manage';

/**
 * RFC-4180 CSV serializer for the flashcards manage export (v0.10.2 F1 Task B;
 * stats columns added in F3 Task C).
 *
 * Mirrors `src/lib/audit/csv.ts`: fixed column list, RFC-4180 quoting (comma /
 * quote / newline → wrapped + internal quotes doubled), and the OWASP CSV-
 * injection guard (a leading `= + - @` gets a `'` prefix so a hostile front/back
 * can't execute as a spreadsheet formula). Dates serialize as ISO-8601; the
 * `tags` array joins on a space inside one cell.
 *
 * F3 Task C appends two stats columns AFTER the original set (existing headers
 * and order are preserved so prior importers keep working):
 *   - `lastGrade`  : the most recent SM-2 grade (0=Again, 1=Hard, 2=Good,
 *                    3=Easy), or blank if the card was never reviewed.
 *   - `retained`   : a per-card retention-contribution flag — `1` when the last
 *                    review was a pass (lastGrade >= 2, i.e. Good or Easy), else
 *                    `0`. Blank for never-reviewed cards (lastGrade null), so an
 *                    AVG() over the column gives the rolling retention rate.
 */

export const FLASHCARD_CSV_COLUMNS = [
  'front',
  'back',
  'deck',
  'tags',
  'state',
  'due',
  'interval',
  'ease',
  'reps',
  'lastGrade',
  'retained',
] as const;

/** Pass threshold: SM-2 grades >= this count as a successful recall. */
const RETENTION_PASS_GRADE = 2;

export type FlashcardCsvColumn = (typeof FLASHCARD_CSV_COLUMNS)[number];

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);
const CRLF = '\r\n';

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (s.length > 0 && FORMULA_TRIGGERS.has(s.charAt(0))) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function fieldFor(card: ManageCard, column: FlashcardCsvColumn): string {
  switch (column) {
    case 'front':
      return csvField(card.front);
    case 'back':
      return csvField(card.back);
    case 'deck':
      return csvField(card.deckName ?? '');
    case 'tags':
      return csvField(card.tags.join(' '));
    case 'state':
      return csvField(card.state);
    case 'due':
      return csvField(card.dueAt);
    case 'interval':
      return csvField(card.interval);
    case 'ease':
      return csvField(card.ease);
    case 'reps':
      return csvField(card.reps);
    case 'lastGrade':
      return csvField(card.lastGrade);
    case 'retained':
      // Blank for never-reviewed cards so it's excluded from an AVG() retention
      // rate; otherwise 1 if the last review passed (Good/Easy), else 0.
      return card.lastGrade === null || card.lastGrade === undefined
        ? ''
        : csvField(card.lastGrade >= RETENTION_PASS_GRADE ? 1 : 0);
  }
}

export function flashcardsCsvHeader(): string {
  return `${FLASHCARD_CSV_COLUMNS.join(',')}${CRLF}`;
}

export function flashcardsToCsv(cards: ManageCard[]): string {
  const rows = cards
    .map((card) => `${FLASHCARD_CSV_COLUMNS.map((c) => fieldFor(card, c)).join(',')}${CRLF}`)
    .join('');
  return `${flashcardsCsvHeader()}${rows}`;
}
