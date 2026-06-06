import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('sidebar density tokens (#130)', () => {
  it('defines the sidebar body text-size token at 13px', () => {
    expect(css).toMatch(/--cairn-sidebar-text:\s*13px/);
  });
  it('defines the sidebar line-height token at 18px', () => {
    expect(css).toMatch(/--cairn-sidebar-leading:\s*18px/);
  });
});

const treeSrc = readFileSync(
  join(process.cwd(), 'src/components/sidebar/virtualized-page-tree.tsx'),
  'utf8',
);

describe('sidebar tree row height (C-v3 optional)', () => {
  it('ROW_HEIGHT_PX is 26 (denser tree)', () => {
    expect(treeSrc).toMatch(/ROW_HEIGHT_PX\s*=\s*26/);
  });
});

describe('sidebar padding tokens (C-v3 optional)', () => {
  it('defines --cairn-sidebar-px token', () => {
    expect(css).toMatch(/--cairn-sidebar-px:\s*6px/);
  });
  it('defines --cairn-sidebar-section-gap token', () => {
    expect(css).toMatch(/--cairn-sidebar-section-gap:\s*6px/);
  });
});
