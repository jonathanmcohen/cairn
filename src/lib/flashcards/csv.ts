import type { ManageCard } from './manage';

/**
 * RFC-4180 CSV serializer for the flashcards manage export (v0.10.2 F1 Task B).
 *
 * Mirrors `src/lib/audit/csv.ts`: fixed column list, RFC-4180 quoting (comma /
 * quote / newline → wrapped + internal quotes doubled), and the OWASP CSV-
 * injection guard (a leading `= + - @` gets a `'` prefix so a hostile front/back
 * can't execute as a spreadsheet formula). Dates serialize as ISO-8601; the
 * `tags` array joins on a space inside one cell.
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
] as const;

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
