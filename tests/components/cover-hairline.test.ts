import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('cover bottom hairline (#8)', () => {
  it('.cairn-cover carries a token-driven bottom border', () => {
    const rule = css.match(/\.cairn-cover\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(rule).toMatch(/border-bottom:\s*1px solid hsl\(var\(--border\)\)/);
  });
});
