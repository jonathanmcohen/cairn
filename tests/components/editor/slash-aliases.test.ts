import { describe, expect, it } from 'vitest';
import { matchesSlashQuery, SLASH_ITEMS } from '@/components/editor/slash-extension';

describe('slash item keyword aliases (#148)', () => {
  it('exports the full catalog with a keywords array on every item', () => {
    expect(SLASH_ITEMS.length).toBeGreaterThan(20);
    for (const item of SLASH_ITEMS) {
      expect(Array.isArray(item.keywords)).toBe(true);
    }
  });

  it('seeds the spec aliases', () => {
    const byTitle = (t: string) => SLASH_ITEMS.find((i) => i.title === t);
    expect(byTitle('Equation')?.keywords).toContain('math');
    expect(byTitle('Embed')?.keywords).toEqual(expect.arrayContaining(['iframe', 'youtube']));
    expect(byTitle('Image')?.keywords).toEqual(expect.arrayContaining(['img', 'picture', 'photo']));
    expect(byTitle('Code')?.keywords).toContain('snippet');
    expect(byTitle('Page embed')?.keywords).toContain('page');
    expect(byTitle('Divider')?.keywords).toEqual(expect.arrayContaining(['hr', 'line']));
    expect(byTitle('Citation')?.keywords).toEqual(expect.arrayContaining(['cite', 'ref']));
    expect(byTitle('Footnote')?.keywords).toContain('note');
    expect(byTitle('Mermaid diagram')?.keywords).toEqual(
      expect.arrayContaining(['diagram', 'flowchart']),
    );
    expect(byTitle('Flashcard')?.keywords).toEqual(expect.arrayContaining(['anki', 'card']));
    expect(byTitle('Task list')?.keywords).toEqual(expect.arrayContaining(['check', 'todo']));
    expect(byTitle('Bookmark')?.keywords).toContain('link');
  });
});

describe('matchesSlashQuery (#148)', () => {
  const item = {
    title: 'Equation',
    description: 'Block math',
    category: 'advanced' as const,
    command: () => {},
    keywords: ['math', 'latex', 'katex'],
  };
  it('matches on title substring', () => {
    expect(matchesSlashQuery(item, 'equa')).toBe(true);
  });
  it('matches on a keyword substring', () => {
    expect(matchesSlashQuery(item, 'math')).toBe(true);
    expect(matchesSlashQuery(item, 'kat')).toBe(true);
  });
  it('is case-insensitive and empty-query matches everything', () => {
    expect(matchesSlashQuery(item, 'MATH')).toBe(true);
    expect(matchesSlashQuery(item, '')).toBe(true);
  });
  it('returns false when neither title nor keyword matches', () => {
    expect(matchesSlashQuery(item, 'zzz')).toBe(false);
  });
});
