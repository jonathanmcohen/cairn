import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src/components/sidebar.tsx'), 'utf8');

describe('sidebar default width (C1 v0.9.14)', () => {
  it('falls back to 15rem (240px), matching Notion default', () => {
    expect(src).toContain('var(--cairn-sidebar-w, 15rem)');
    expect(src).not.toContain('var(--cairn-sidebar-w, 14rem)');
  });
});
