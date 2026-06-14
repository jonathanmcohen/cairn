/**
 * Plan C1/C2 (v0.9.14) — sidebar width + text density.
 * Source-assertion regression slice. C1 widens the default width fallback to
 * 15rem (240px); C2 is regression-only (the sidebar-flashcards density triplet
 * shipped earlier — guard it against regression to bare text-sm).
 *
 * v0.10.2 F1 Task D: the standalone StudyLink that originally carried this
 * triplet was folded into FlashcardsNav, which inherits the same triplet — so
 * the C2 guard now points at flashcards-nav.tsx.
 * See docs/superpowers/plans/v0.9.14/plan-C-ui-density-polish.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sidebar = readFileSync(join(process.cwd(), 'src/components/sidebar.tsx'), 'utf8');
const flashcardsNav = readFileSync(
  join(process.cwd(), 'src/components/sidebar/flashcards-nav.tsx'),
  'utf8',
);

describe('Plan C1 — sidebar default width', () => {
  it('falls back to 15rem (240px), not 14rem', () => {
    expect(sidebar).toContain('var(--cairn-sidebar-w, 15rem)');
    expect(sidebar).not.toContain('var(--cairn-sidebar-w, 14rem)');
  });
});

describe('Plan C2 — sidebar text density (regression; shipped)', () => {
  it('FlashcardsNav carries the 13px density triplet, not bare text-sm', () => {
    expect(flashcardsNav).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(flashcardsNav).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(flashcardsNav).toContain('tracking-[0.1px]');
    expect(flashcardsNav).not.toMatch(/(^|["\s])text-sm(["\s])/);
  });
});
