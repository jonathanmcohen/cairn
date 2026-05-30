import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
// The themed primitives themselves contain these strings (in JSDoc/comments and
// calendar.tsx's intentional native-date reference). Exclude that one dir.
const EXCLUDE_DIRS = new Set([join(SRC, 'components', 'ui')]);

function walk(dir: string, out: string[] = []): string[] {
  if (EXCLUDE_DIRS.has(dir)) return out;
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('native form-control guard (#38)', () => {
  const files = walk(SRC);

  it('has no raw <select element under src/ (outside ui primitives)', () => {
    const offenders = files.filter((f) => /<select[\s>]/.test(readFileSync(f, 'utf8')));
    expect(
      offenders.map((f) => f.replace(`${process.cwd()}/`, '')),
      'convert these to the themed <Select> primitive',
    ).toEqual([]);
  });

  it('has no native <input type="date"|"datetime-local"> under src/ (outside ui primitives)', () => {
    const offenders = files.filter((f) =>
      /type="(date|datetime-local)"/.test(readFileSync(f, 'utf8')),
    );
    expect(
      offenders.map((f) => f.replace(`${process.cwd()}/`, '')),
      'convert these to the themed <DateField> primitive',
    ).toEqual([]);
  });
});
