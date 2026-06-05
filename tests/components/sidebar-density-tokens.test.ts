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
