import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// v0.9.14 Plan U (U3) — the search palette <Command> container should mount
// with a decorative fade+zoom entry animation at the rubric-recommended 150ms.
// tw-animate-css respects prefers-reduced-motion automatically, so no explicit
// motion-safe guard is needed.
describe('search palette entry animation (U3)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/search-palette.tsx'), 'utf8');

  it('the Command container carries the animate-in fade+zoom classes', () => {
    // The outermost palette container is the <Command> with bg-popover.
    const commandLine = src
      .split('\n')
      .find((l) => l.includes('bg-popover') && l.includes('shadow-xl'));
    expect(commandLine).toBeDefined();
    expect(commandLine).toContain('animate-in');
    expect(commandLine).toContain('fade-in-0');
    expect(commandLine).toContain('zoom-in-95');
    expect(commandLine).toContain('duration-150');
  });
});
