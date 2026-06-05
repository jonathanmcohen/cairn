import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('prose typography tokens + scale (#1)', () => {
  it('defines the base measure tokens', () => {
    expect(css).toMatch(/--cairn-prose-base:\s*16px/);
    expect(css).toMatch(/--cairn-prose-leading:\s*1\.6/);
  });
  it('scopes a tightened heading scale to .ProseMirror', () => {
    expect(css).toMatch(/\.ProseMirror\s+h1[\s,{]/);
    expect(css).toMatch(/font-size:\s*1\.875rem/);
    expect(css).toMatch(/letter-spacing:\s*-0\.01em/);
  });
});
