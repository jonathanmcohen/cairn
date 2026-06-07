# Postmortem — #140 Export returns 500 for ALL formats (production)

**Status:** root cause PROVEN · fix = Plan A1 · severity P0 (export feature fully down in the shipped image).

## Impact
Every page-export request (`GET /api/pages/:id/export?format=…`) returns HTTP 500 with a generic `Internal Server Error` body — **all formats**, including `md` and `json` that need no browser. Export is 100% broken in the deployed standalone image. Dev (`pnpm dev`) and the test suite pass, which masked it.

## Symptom vs. handler
The export route's `catch` block returns a structured JSON `{ error }` 500. The observed body is the **generic** Next.js `Internal Server Error`, not that JSON. A generic 500 means the failure happens **before/while the route module loads** — the handler never runs, so its try/catch never engages. That points at module-load, not request logic.

## Root cause
`src/app/api/pages/[pageId]/export/route.ts` statically imports `pageToPdf` from `src/lib/export/pdf-native.ts`. `pdf-native.ts` has a **top-level value import**:

```ts
import { chromium } from '@playwright/test'   // module-load side effect
```

`next build` with `output: 'standalone'` file-traces the route's import graph. `@playwright/test` → `playwright-core` pulls runtime data files (e.g. `playwright-core/.../browsers.json`) that the trace **does not** copy into `.next/standalone/node_modules`. At runtime the compiled route's static import of `@playwright/test` throws:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../playwright-core@1.60.0/.../playwright-core/browsers.json'
```

Because the import is at the **top** of a module the route imports unconditionally, the throw happens at route-module evaluation → generic 500 for every format, even ones that never call `pageToPdf`.

This is the **same class of bug** as the v0.9.12 collab crash (`ERR_MODULE_NOT_FOUND reconcile-raw.js`): a dependency present in dev/test but absent from the shipped artifact because the build's file-tracing/copy step dropped it. Lesson re-confirmed: **verify against the real built artifact, not dev/test.**

## Fix (Plan A1)
1. Remove the top-level value import of `@playwright/test` from `pdf-native.ts`; keep `import type { Browser }` (types are erased, no runtime trace).
2. Inside `pageToPdf()` — only reached when `CAIRN_NATIVE_PDF === '1'` — do `const { chromium } = await import('@playwright/test')`. Native PDF is opt-in; the default path (`pdf-print-html`) never loads Playwright.
3. **Build-graph guard test:** assert the export route's static-import closure contains no static `from '@playwright/test'` (source/AST check, mirrors `tests/collab/dockerfile-copies-imports.test.ts`). Prevents recurrence.
4. **Per-format integration tests:** md/html/docx/json → 200 + content-type + non-empty; recursive → `application/zip`; pdf default → 200 `text/html`.
5. **Verify on the artifact:** `pnpm build`, then confirm importing `.next/standalone/.next/server/app/api/pages/[pageId]/export/route.js` no longer rejects.

## Why dev/test missed it
Dev (`next dev`) and Vitest resolve from the full `node_modules`, where `@playwright/test` and its data files exist. Only the file-traced standalone bundle omits them. No test exercised the built standalone artifact → green CI, broken prod.

## Prevention
- Guard test (#3 above) for this specific route.
- Treat ANY top-level value import of a heavy/optional dep (`@playwright/test`, browser engines, native bins) inside an API-route import graph as a build-artifact risk → lazy `await import()` behind the feature flag.
- Plan V CI matrix keeps export tests in a dedicated `api` suite for faster signal.
- Standing lesson added: a green dev/test run does not certify the standalone image; artifact-level verification required for export/collab/native-dep paths.
