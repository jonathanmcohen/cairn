// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const script = join(repoRoot, 'scripts', 'copy-emoji-data.mjs');
const dest = join(repoRoot, 'public', 'emoji-data.json');

describe('copy-emoji-data', () => {
  afterAll(() => {
    // Re-run to restore the file for the dev server / other tests.
    execFileSync('node', [script], { cwd: repoRoot });
  });

  it('writes public/emoji-data.json as a non-trivial emojibase array', () => {
    rmSync(dest, { force: true });
    expect(existsSync(dest)).toBe(false);

    execFileSync('node', [script], { cwd: repoRoot });

    expect(existsSync(dest)).toBe(true);
    const data = JSON.parse(readFileSync(dest, 'utf8')) as unknown;
    expect(Array.isArray(data)).toBe(true);
    // emojibase "en" dataset has well over a thousand entries; guard against a
    // truncated / wrong file that would render an empty grid (#130).
    expect((data as unknown[]).length).toBeGreaterThan(1000);
    // Spot-check the emojibase shape the web component consumes.
    const first = (data as Array<Record<string, unknown>>)[0];
    expect(first).toHaveProperty('annotation');
    expect(first).toHaveProperty('group');
  });
});
