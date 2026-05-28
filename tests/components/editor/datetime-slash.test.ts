import { describe, expect, it } from 'vitest';
import { datetimeMenuItem } from '@/components/editor/slash-extension';

describe('/datetime slash entry', () => {
  it('exists with command + run', () => {
    expect(datetimeMenuItem.command).toBe('/datetime');
    expect(typeof datetimeMenuItem.run).toBe('function');
  });

  it('has a title + description', () => {
    expect(datetimeMenuItem.title).toBe('Date/time');
    expect(datetimeMenuItem.description).toContain('timezone');
  });
});
