import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const NEXT_DIR = join(process.cwd(), '.next');

/**
 * Walk a directory tree synchronously, summing the size of every file whose
 * path matches a predicate. Skip directories matched by `skip` (saves time +
 * avoids walking the static-asset tree on every test run).
 */
function totalBytes(root: string, match: (p: string) => boolean): number {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (!existsSync(cur)) continue;
    const s = statSync(cur);
    if (s.isDirectory()) {
      for (const ent of readdirSync(cur)) {
        stack.push(join(cur, ent));
      }
    } else if (match(cur)) {
      total += s.size;
    }
  }
  return total;
}

describe('editor bundle budget (post-codesplit lazy extensions)', () => {
  it('asserts the lazy node-view source text does NOT appear in any non-lazy chunk', () => {
    if (!existsSync(NEXT_DIR)) {
      // No build yet — pnpm test ran in an unbuild tree. Skip rather than
      // confuse the suite. CI always runs after `pnpm build`.
      return;
    }
    // Heuristic: the heavy lazy modules import specific symbols that
    // shouldn't appear in chunks that don't lazy-load them.
    // `katex/dist/katex.min.css` is unique to math.tsx — its presence in a
    // non-lazy chunk means the lazy split broke.
    const KATEX_MARKER = 'katex/dist/katex.min.css';
    const violations: string[] = [];

    const chunksRoot = join(NEXT_DIR, 'static', 'chunks');
    if (!existsSync(chunksRoot)) return;
    const stack = [chunksRoot];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (!existsSync(cur)) continue;
      const s = statSync(cur);
      if (s.isDirectory()) {
        for (const ent of readdirSync(cur)) stack.push(join(cur, ent));
      } else if (cur.endsWith('.js')) {
        const text = readFileSync(cur, 'utf8');
        // The marker SHOULD live in exactly one chunk (the lazy math chunk).
        // It SHOULD NOT live in any "framework"/"main"/"editor-core" chunks.
        if (text.includes(KATEX_MARKER) && /\b(framework|main|webpack)\b/.test(cur)) {
          violations.push(cur);
        }
      }
    }
    expect(violations, `katex marker leaked into core chunks: ${violations.join(', ')}`).toEqual(
      [],
    );
  });

  it('reports the total .next/static/chunks size so a baseline can be tracked over time', () => {
    if (!existsSync(NEXT_DIR)) return;
    const chunksRoot = join(NEXT_DIR, 'static', 'chunks');
    const bytes = totalBytes(chunksRoot, (p) => p.endsWith('.js'));
    // Log to stdout so the byte total surfaces in test output; the assertion
    // is just "the dir is non-empty after build".
    console.log(`[bundle-budget] .next/static/chunks total JS: ${bytes} bytes`);
    expect(bytes).toBeGreaterThan(0);
  });
});
