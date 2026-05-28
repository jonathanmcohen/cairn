import { describe, expect, it } from 'vitest';
import { citationMenuItem, footnoteMenuItem } from '@/components/editor/slash-extension';

describe('citation + footnote slash entries', () => {
  it('/citation present', () => {
    expect(citationMenuItem.command).toBe('/citation');
    expect(typeof citationMenuItem.run).toBe('function');
  });
  it('/footnote present', () => {
    expect(footnoteMenuItem.command).toBe('/footnote');
    expect(typeof footnoteMenuItem.run).toBe('function');
  });
});
