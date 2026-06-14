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
    const csv = flashcardsToCsv([card({ lastGrade: 2 })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(FLASHCARD_CSV_COLUMNS.join(','));
    // …,reps=3,lastGrade=2,retained=1 (grade 2 = Good is a pass).
    expect(lines[1]).toBe(
      'Front,Back,Spanish,verb core,review,2026-06-20T00:00:00.000Z,6,2.5,3,2,1',
    );
  });

  it('appends the F3 stats columns (lastGrade, retained)', () => {
    expect(FLASHCARD_CSV_COLUMNS).toContain('lastGrade');
    expect(FLASHCARD_CSV_COLUMNS).toContain('retained');
    // Original columns are preserved in their original order at the front.
    expect(FLASHCARD_CSV_COLUMNS.slice(0, 9)).toEqual([
      'front',
      'back',
      'deck',
      'tags',
      'state',
      'due',
      'interval',
      'ease',
      'reps',
    ]);
  });

  it('marks a failing last grade as not retained, a passing one as retained', () => {
    const lastGradeIdx = FLASHCARD_CSV_COLUMNS.indexOf('lastGrade');
    const retainedIdx = FLASHCARD_CSV_COLUMNS.indexOf('retained');

    const again = flashcardsToCsv([card({ lastGrade: 0 })])
      .split('\r\n')[1]!
      .split(',');
    expect(again[lastGradeIdx]).toBe('0');
    expect(again[retainedIdx]).toBe('0');

    const easy = flashcardsToCsv([card({ lastGrade: 3 })])
      .split('\r\n')[1]!
      .split(',');
    expect(easy[lastGradeIdx]).toBe('3');
    expect(easy[retainedIdx]).toBe('1');
  });

  it('leaves lastGrade/retained blank for a never-reviewed card', () => {
    const lastGradeIdx = FLASHCARD_CSV_COLUMNS.indexOf('lastGrade');
    const retainedIdx = FLASHCARD_CSV_COLUMNS.indexOf('retained');
    const cells = flashcardsToCsv([card({ lastGrade: null })])
      .split('\r\n')[1]!
      .split(',');
    expect(cells[lastGradeIdx]).toBe('');
    expect(cells[retainedIdx]).toBe('');
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
