/**
 * Plan A1 (#140) — export route must not 500 in the standalone artifact.
 * Contract stub. Real assertions land with Plan A1. See
 * docs/superpowers/v0.9.14/plan-A-critical-hotfixes.md + postmortem-export-500.md.
 *
 * NOTE: discovered only once Plan V widens vitest `include` to *.spec.ts.
 */
import { describe, it } from 'vitest';

describe('Plan A1 #140 — page export', () => {
  it.todo('export route static-import closure contains NO `from "@playwright/test"` (build-graph guard)');
  it.todo('format=md → 200, text/markdown, non-empty body');
  it.todo('format=json → 200, application/json, non-empty body');
  it.todo('format=html → 200, text/html, non-empty body');
  it.todo('format=docx → 200, docx content-type, non-empty body');
  it.todo('format=pdf (default pdf-print-html) → 200, text/html');
  it.todo('recursive=1 → 200, application/zip');
  it.todo('built standalone route module imports without throwing ERR_MODULE_NOT_FOUND');
});
