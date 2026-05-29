#!/usr/bin/env tsx
/**
 * Walk every .ts/.tsx file under a directory, flag user-facing English string
 * literals that aren't running through t()/copy(). Pure: emits a JSON report
 * sorted by (file, line, text) for deterministic diffs.
 *
 * Used by:
 *   - `pnpm i18n:check` (CI) — diffs against i18n-audit.baseline.json.
 *   - This plan's tests.
 *
 * Heuristic, not perfect — `// biome-ignore i18n: <reason>` on the line above
 * or the same line is the explicit escape hatch.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export type Finding = {
  file: string;
  line: number;
  text: string;
  kind: 'jsx_text' | 'jsx_attr';
};
export type AuditReport = { findings: Finding[] };

const PUNCT_ONLY = /^[\s\-_/.,:;!?–—'"`(){}[\]<>·•]*$/u;
const UNIT_ONLY = /^[\d.,]+\s*(px|rem|em|%|s|ms|kb|mb|gb)$/i;
const I18N_IGNORE = /\/\/\s*biome-ignore\s+i18n\b/;
const ATTR_KEYS = new Set(['aria-label', 'placeholder', 'title', 'alt']);

function shouldSkip(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (PUNCT_ONLY.test(trimmed)) return true;
  if (UNIT_ONLY.test(trimmed)) return true;
  // Skip strings without any letter (e.g. '{', '12,345').
  if (!/[A-Za-z]/.test(trimmed)) return true;
  // Skip very short single-letter strings (e.g. 'x' placeholders, single-char
  // icons). One-letter text is never a real user-facing message — translatable
  // copy is always >= 2 chars.
  if (trimmed.length < 2) return true;
  return false;
}

/** Find files recursively. Skip node_modules, .next, dist, and shadcn ui dirs. */
function walk(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === 'dist' ||
      entry === '.git' ||
      entry === 'ui' // shadcn primitive directories — not user-authored copy.
    ) {
      continue;
    }
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function isIgnoredLine(src: string, lineIndex: number): boolean {
  // lineIndex is 1-based. Look at line above + same line for the annotation.
  const lines = src.split('\n');
  const above = lines[lineIndex - 2] ?? '';
  const here = lines[lineIndex - 1] ?? '';
  return I18N_IGNORE.test(above) || I18N_IGNORE.test(here);
}

function getLine(src: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

function scanFile(filePath: string, rootDir: string): Finding[] {
  const src = readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );
  const out: Finding[] = [];
  const relPath = relative(rootDir, filePath);

  const visit = (node: ts.Node): void => {
    // JSX raw text.
    if (ts.isJsxText(node)) {
      const text = node.text;
      if (!shouldSkip(text)) {
        const line = getLine(src, node.getStart(sf));
        if (!isIgnoredLine(src, line)) {
          out.push({ file: relPath, line, text: text.trim(), kind: 'jsx_text' });
        }
      }
    }
    // JSX attribute: aria-label="..." etc.
    if (ts.isJsxAttribute(node) && node.name) {
      const name = node.name.getText(sf);
      if (ATTR_KEYS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const text = node.initializer.text;
        if (!shouldSkip(text)) {
          const line = getLine(src, node.initializer.getStart(sf));
          if (!isIgnoredLine(src, line)) {
            out.push({ file: relPath, line, text, kind: 'jsx_attr' });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function auditDirectory(root: string): AuditReport {
  const files = walk(root);
  const findings = files.flatMap((f) => scanFile(f, root));
  findings.sort((a, b) =>
    a.file !== b.file
      ? a.file.localeCompare(b.file)
      : a.line !== b.line
        ? a.line - b.line
        : a.text.localeCompare(b.text),
  );
  return { findings };
}

/** CLI entry: write report to disk, fail-exit when count > baseline. */
function main(): void {
  const root = process.cwd();
  const srcRoot = join(root, 'src');
  if (!existsSync(srcRoot)) {
    console.error(`i18n-audit: src/ not found at ${srcRoot}`);
    process.exit(2);
  }
  const report = auditDirectory(srcRoot);
  writeFileSync(join(root, 'i18n-audit.report.json'), JSON.stringify(report, null, 2));

  // Compare against baseline.
  const baselinePath = join(root, 'i18n-audit.baseline.json');
  if (!existsSync(baselinePath)) {
    console.warn(
      `i18n-audit: no baseline at ${baselinePath}; first run — writing baseline. Re-run to enforce.`,
    );
    // Trailing newline so the committed baseline passes `biome check`
    // (the CI Lint step lints JSON too).
    writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as AuditReport;
  const baselineKeys = new Set(baseline.findings.map((f) => `${f.file}:${f.text}`));
  const newFindings = report.findings.filter((f) => !baselineKeys.has(`${f.file}:${f.text}`));
  if (newFindings.length > 0) {
    console.error(`i18n-audit: ${newFindings.length} new hardcoded string(s) introduced:`);
    for (const f of newFindings) {
      console.error(`  ${f.file}:${f.line}  "${f.text}"`);
    }
    process.exit(1);
  }
  console.info(`i18n-audit: ${report.findings.length} total findings, none new.`);
}

// Only run main when invoked as a CLI, not when imported by tests.
const isCli = typeof process !== 'undefined' && process.argv[1]?.endsWith('i18n-audit.ts');
if (isCli) main();
