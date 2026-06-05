import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src/components/sidebar.tsx'), 'utf8');

describe('sidebar default width (#131)', () => {
  it('falls back to 14rem (224px), not 16rem', () => {
    expect(src).toContain('var(--cairn-sidebar-w, 14rem)');
    expect(src).not.toContain('var(--cairn-sidebar-w, 16rem)');
  });
});
