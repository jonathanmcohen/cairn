import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('Inter font wiring (#1)', () => {
  it('instantiates Inter from next/font/google with display: swap', () => {
    expect(layout).toMatch(/from ['"]next\/font\/google['"]/);
    expect(layout).toMatch(/Inter\(/);
    expect(layout).toMatch(/display:\s*['"]swap['"]/);
    expect(layout).toMatch(/variable:\s*['"]--font-inter['"]/);
  });
  it('prepends the Inter variable to the cairn font stack', () => {
    expect(css).toMatch(/--cairn-font-family:\s*\n?\s*var\(--font-inter\)/);
  });
});
