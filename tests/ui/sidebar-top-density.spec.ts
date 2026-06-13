/**
 * Plan C (v0.9.16, #144) — top-of-sidebar density.
 * Source-assertion slice: the four interactive rows above the PAGES tree are
 * compacted on FINE pointers while the pointer-coarse:min-h-11 (44px, WCAG
 * 2.5.5) touch floor is preserved. CSS is not computed in jsdom, so we assert
 * on the class strings / token references, not measured pixels.
 * See docs/superpowers/plans/v0.9.16/plan-C-top-sidebar-density.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const switcher = read('src/components/workspace-switcher.tsx');
const searchHint = read('src/components/search-hint-button.tsx');
const savedSearches = read('src/components/sidebar/saved-searches.tsx');
const pagesSection = read('src/components/sidebar/pages-section.tsx');

describe('Plan C #144 — workspace switcher trigger row', () => {
  it('compacts to 32px on fine pointer, keeps min-h-11 on coarse', () => {
    expect(switcher).toContain('min-h-[32px]');
    expect(switcher).toContain('pointer-coarse:min-h-11');
    // padding shrinks on fine pointer; touch restores py-1.5
    expect(switcher).toContain('py-0.5');
    expect(switcher).toContain('pointer-coarse:py-1.5');
    // density font token retained (was already 13px); no regression to text-sm
    // on the TRIGGER row. (The out-of-scope ITEM_CLASS dropdown rows keep
    // text-sm per the plan, so scope this guard to the trigger className.)
    const trigger = switcher.slice(
      switcher.indexOf('<DropdownMenu.Trigger'),
      switcher.indexOf('</DropdownMenu.Trigger>'),
    );
    expect(trigger).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(trigger).not.toMatch(/(^|["\s])text-sm(["\s])/);
  });

  it('keeps the #320 InlineIcon badge in the trigger', () => {
    // the density edit must not remove the workspace-icon badge (#142/#320)
    expect(switcher).toContain('<InlineIcon');
    expect(switcher).toMatch(/h-5 w-5[^"]*bg-muted/);
  });
});

describe('Plan C #144 — command palette button', () => {
  it('compacts to 36px on fine pointer, keeps min-h-11 on coarse', () => {
    expect(searchHint).toContain('min-h-[36px]');
    expect(searchHint).toContain('pointer-coarse:min-h-11');
    expect(searchHint).toContain('py-0.5');
    expect(searchHint).toContain('pointer-coarse:py-1.5');
    // mb 8 -> 4
    expect(searchHint).toContain('mb-1');
    expect(searchHint).not.toContain('mb-2');
    // adopt the density font token (was text-sm)
    expect(searchHint).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(searchHint).not.toMatch(/(^|["\s])text-sm(["\s])/);
  });
});

describe('Plan C #144 — section header (Saved searches)', () => {
  it('tightens margins and shrinks the label to 11px', () => {
    expect(savedSearches).toContain('mb-2'); // section was mb-3
    expect(savedSearches).not.toContain('mb-3');
    expect(savedSearches).toContain('mb-0.5'); // header row was mb-1
    expect(savedSearches).toContain('text-[length:var(--cairn-sidebar-heading)]'); // 10px token (S4; was 11px, before that text-xs)
  });
});

describe('Plan C #144 — PAGES header row', () => {
  it('compacts the header to 28px dense, keeps coarse floor + badge-safe label', () => {
    expect(pagesSection).toContain('min-h-[28px]');
    expect(pagesSection).toContain('pointer-coarse:min-h-11');
    expect(pagesSection).toContain('py-0.5'); // was py-1
    expect(pagesSection).toContain('pointer-coarse:py-1.5');
    expect(pagesSection).toContain('mb-0.5'); // header was mb-1
    expect(pagesSection).toContain('text-[length:var(--cairn-sidebar-heading)]'); // 10px token (S4; was 11px, before that text-xs)
    // sticky/z/bg chrome from C3 (#209) must remain
    expect(pagesSection).toContain('sticky top-0 z-10');
    expect(pagesSection).toContain('bg-card');
  });
});
