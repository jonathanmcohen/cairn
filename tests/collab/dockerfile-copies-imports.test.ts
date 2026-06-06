import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression guard for the v0.9.11 → v0.9.12 collab crash-loop.
//
// `Dockerfile.collab` ships a CURATED subset of `src/` (collab, auth,
// observability, flashcards/{extract,reconcile-raw}) — NOT all of src. When
// v0.9.11 added `import '@/lib/flashcards/reconcile-raw.js'` to collab/server.ts
// without a matching COPY, the runtime image was missing the file and the
// container crash-looped (ERR_MODULE_NOT_FOUND). Local typecheck/tests/build
// never caught it because none of them build or run the collab image.
//
// This test fails the moment server.ts imports a `../src/lib/...` module that
// Dockerfile.collab does not COPY, so the gap is caught in CI instead of prod.

const root = process.cwd();
const server = readFileSync(join(root, 'collab/server.ts'), 'utf8');
const dockerfile = readFileSync(join(root, 'Dockerfile.collab'), 'utf8');

// `src/...` tokens from every `COPY <src...> <dest>` line (last token is dest).
const copiedPaths = dockerfile
  .split('\n')
  .filter((l) => /^COPY\b/.test(l.trim()))
  .flatMap((l) =>
    l
      .trim()
      .replace(/^COPY\s+/, '')
      .split(/\s+/)
      .slice(0, -1),
  )
  .filter((p) => p.startsWith('src/'));

function isCopied(srcRelPath: string): boolean {
  return copiedPaths.some(
    (c) => srcRelPath === c || srcRelPath.startsWith(`${c.replace(/\/$/, '')}/`),
  );
}

// Value imports from `../src/...` (type-only imports are erased by tsx, so they
// need not be present at runtime).
function valueImportsFromSrc(source: string): string[] {
  const out: string[] = [];
  const re = /import\s+(?!type\b)([^;]*?)\s+from\s+['"](\.\.\/src\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(source)) !== null) {
    // `.js` specifier → `.ts` source file; `../src/x` → `src/x`.
    out.push(m[2]!.replace(/^\.\.\//, '').replace(/\.js$/, '.ts'));
  }
  return out;
}

describe('Dockerfile.collab COPYs every runtime import of collab/server.ts', () => {
  it('parses at least one COPY src path', () => {
    expect(copiedPaths.length).toBeGreaterThan(0);
  });

  it('every ../src value import in server.ts is present in the image', () => {
    const imports = valueImportsFromSrc(server);
    expect(imports.length).toBeGreaterThan(0);
    const missing = imports.filter((p) => !isCopied(p));
    expect(missing, `Dockerfile.collab is missing COPY for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the flashcards reconcile path (and its extract dep) is copied', () => {
    expect(isCopied('src/lib/flashcards/reconcile-raw.ts')).toBe(true);
    expect(isCopied('src/lib/flashcards/extract.ts')).toBe(true);
  });
});
