import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src/components/editor/drag-handle.tsx'), 'utf8');

describe('drag-handle hover transition (#7)', () => {
  it('both handle buttons ease their hover tint', () => {
    const matches = src.match(/transition-colors duration-150/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
