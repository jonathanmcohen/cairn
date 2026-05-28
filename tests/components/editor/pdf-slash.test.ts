// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pdfSlashItem } from '@/components/editor/slash-extension';

describe('pdf slash menu entry', () => {
  it('exposes a "PDF" entry with a function command', () => {
    expect(pdfSlashItem.title).toBe('PDF');
    expect(pdfSlashItem.description).toMatch(/pdf/i);
    expect(typeof pdfSlashItem.command).toBe('function');
  });
});
