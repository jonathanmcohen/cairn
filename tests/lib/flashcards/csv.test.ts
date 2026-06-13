import { describe, expect, it } from 'vitest';
import { csvField, FLASHCARD_CSV_COLUMNS, flashcardsToCsv } from '@/lib/flashcards/csv';
import type { ManageCard } from '@/lib/flashcards/manage';

function card(over: Partial<ManageCard> = {}): ManageCard {
  return {
    id: 'c1',
    front: 'Front',
    back: 'Back',
    deckId: null,
    deckName: 'Spanish',
    tags: ['verb', 'core'],
    pageId: null,
    pageTitle: null,
    sourceOrphanedAt: null,
    suspendedAt: null,
    ease: 2.5,
    interval: 6,
    reps: 3,
    dueAt: new Date('2026-06-20T00:00:00.000Z'),
    lastReviewedAt: null,
    lastGrade: null,
    state: 'review',
    ...over,
  };
}

describe('flashcards CSV', () => {
  it('emits a header then one row per card with all columns', () => {
    const csv = flashcardsToCsv([card()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(FLASHCARD_CSV_COLUMNS.join(','));
    expect(lines[1]).toBe('Front,Back,Spanish,verb core,review,2026-06-20T00:00:00.000Z,6,2.5,3');
  });

  it('quotes fields containing commas / quotes / newlines', () => {
    const csv = flashcardsToCsv([card({ front: 'a, b', back: 'he said "hi"' })]);
    expect(csv).toContain('"a, b"');
    expect(csv).toContain('"he said ""hi"""');
  });

  it('guards against CSV formula injection', () => {
    expect(csvField('=cmd()')).toBe("'=cmd()");
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@x')).toBe("'@x");
  });

  it('renders an empty deck/due as blank', () => {
    const csv = flashcardsToCsv([card({ deckName: null, dueAt: null })]);
    const row = csv.split('\r\n')[1]!;
    // deck col (index 2) and due col (index 5) are empty.
    const cells = row.split(',');
    expect(cells[2]).toBe('');
    expect(cells[5]).toBe('');
  });
});
