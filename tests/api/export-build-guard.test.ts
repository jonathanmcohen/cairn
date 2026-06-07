/**
 * Build-graph guard for #140 — export route must never statically import
 * from '@playwright/test'.
 *
 * A static `import { chromium } from '@playwright/test'` in pdf-native.ts
 * causes next-build standalone to trace the playwright-core module graph,
 * which references `playwright-core/browsers.json`. That file is NOT copied
 * into the standalone bundle, so the module fails to load at cold-start and
 * every export format returns 500 — even md/json, which never call pageToPdf.
 *
 * This test reads the source files directly (no compilation, no HTTP) and
 * asserts that no static value import from '@playwright/test' exists. If
 * someone reintroduces the static import the test fails in CI long before it
 * reaches production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const pdfNativeSrc = readFileSync(
  join(root, 'src/lib/export/pdf-native.ts'),
  'utf8',
);
const exportRouteSrc = readFileSync(
  join(root, 'src/app/api/pages/[pageId]/export/route.ts'),
  'utf8',
);

/**
 * Matches lines that are static value imports (not `import type`) from
 * '@playwright/test'. Dynamic `await import(...)` is NOT matched by this
 * regex, which is exactly what we want to allow.
 */
function hasStaticPlaywrightImport(source: string): boolean {
  // Matches: import { ... } from '@playwright/test'
  // Does NOT match: import type { ... } from '@playwright/test'
  // Does NOT match: await import('@playwright/test')
  return /^import\s+(?!type\b)[^;]+from\s+['"]@playwright\/test['"]/m.test(source);
}

describe('export route build-graph guard (#140)', () => {
  it('pdf-native.ts has no static value import from @playwright/test', () => {
    expect(
      hasStaticPlaywrightImport(pdfNativeSrc),
      'pdf-native.ts must not statically import @playwright/test — use dynamic import() inside pageToPdf()',
    ).toBe(false);
  });

  it('pdf-native.ts contains a dynamic import of @playwright/test', () => {
    // After the fix, chromium is obtained via await import('@playwright/test')
    // inside getBrowser(). This assertion documents that the lazy path exists.
    expect(pdfNativeSrc).toMatch(/await\s+import\(['"]@playwright\/test['"]\)/);
  });

  it('export route does not itself statically import @playwright/test', () => {
    expect(
      hasStaticPlaywrightImport(exportRouteSrc),
      'export route.ts must not statically import @playwright/test',
    ).toBe(false);
  });
});
