import { describe, expect, it } from 'vitest';
import { citationLookupMenuItem, SLASH_ITEMS } from '@/components/editor/slash-extension';

describe('Citation (DOI/PubMed lookup) slash item', () => {
  it('exposes the lookup entry with a run fn', () => {
    expect(citationLookupMenuItem.command).toBe('/cite-doi');
    expect(typeof citationLookupMenuItem.run).toBe('function');
    expect(citationLookupMenuItem.keywords).toEqual(
      expect.arrayContaining(['doi', 'pubmed', 'lookup']),
    );
  });

  it('is present in the slash catalog as an advanced item', () => {
    const item = SLASH_ITEMS.find((i) => i.title === 'Citation (DOI/PubMed lookup)');
    expect(item).toBeDefined();
    expect(item?.category).toBe('advanced');
    expect(item?.keywords).toContain('doi');
  });
});
