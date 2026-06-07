import { describe, expect, it } from 'vitest';
import { matchesSlashQuery, SLASH_ITEMS } from '@/components/editor/slash-extension';

describe('slash rename: "Checkbox list" (#139)', () => {
  it('no item is titled "Task list" (old name removed)', () => {
    expect(SLASH_ITEMS.find((i) => i.title === 'Task list')).toBeUndefined();
  });

  it('an item is titled "Checkbox list"', () => {
    expect(SLASH_ITEMS.find((i) => i.title === 'Checkbox list')).toBeDefined();
  });

  it('typing "task" still surfaces the item (keyword alias)', () => {
    const results = SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'task')).map((i) => i.title);
    expect(results).toContain('Checkbox list');
  });

  it('"check" and "todo" still surface the item', () => {
    expect(SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'check')).map((i) => i.title)).toContain(
      'Checkbox list',
    );
    expect(SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'todo')).map((i) => i.title)).toContain(
      'Checkbox list',
    );
  });

  it('"checkbox" and "checklist" surface the item', () => {
    expect(
      SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'checkbox')).map((i) => i.title),
    ).toContain('Checkbox list');
    expect(
      SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'checklist')).map((i) => i.title),
    ).toContain('Checkbox list');
  });

  it('keywords include "task" as an alias', () => {
    const item = SLASH_ITEMS.find((i) => i.title === 'Checkbox list');
    expect(item?.keywords).toContain('task');
  });

  it('has a description distinguishing it from the /my-tasks hub', () => {
    const item = SLASH_ITEMS.find((i) => i.title === 'Checkbox list');
    expect(item?.description).toBeTruthy();
  });
});
