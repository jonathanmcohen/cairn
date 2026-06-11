// v0.10.0 E2 — release-notes generator: parse-logic unit tests + drift guard.
//
// The What's-new panel imports the COMMITTED build-time module
// src/lib/release-notes/notes.generated.ts. `pnpm build` regenerates it
// (`pnpm notes:gen`) before `next build`, but typecheck/dev rely on the
// committed copy — the drift guard below fails the suite whenever
// CHANGELOG.md / package.json moved without re-running the generator.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractSection, generate, renderModule } from '../../scripts/generate-release-notes.mjs';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');

const SAMPLE = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [1.2.3] - 2026-01-01',
  '',
  '### Fixed',
  '',
  '- a thing that was broken',
  '  across two wrapped lines',
  '',
  '## [1.2.2] - 2025-12-01',
  '',
  '- older entry',
].join('\n');

describe('extractSection', () => {
  it('extracts exactly the matching section, including its heading line', () => {
    const section = extractSection(SAMPLE, '1.2.3');
    expect(section).not.toBeNull();
    expect(section).toContain('## [1.2.3] - 2026-01-01');
    expect(section).toContain('- a thing that was broken');
    expect(section).not.toContain('Unreleased');
    expect(section).not.toContain('1.2.2');
  });

  it('returns null when the running version has no section (dev ahead of tags) — never an older section', () => {
    expect(extractSection(SAMPLE, '9.9.9')).toBeNull();
  });

  it('requires an EXACT version match — no prefix matches (0.9.1 must not satisfy 0.9.19)', () => {
    expect(extractSection('## [0.9.1] - 2026-01-01\n\n- nope\n', '0.9.19')).toBeNull();
    expect(extractSection(SAMPLE, '1.2')).toBeNull();
  });

  it('tolerates bare (unbracketed) version headings', () => {
    expect(extractSection('## 2.0.0 - 2026-01-01\n\n- bare\n', '2.0.0')).toContain('- bare');
  });
});

describe('renderModule', () => {
  it('emits null markdown verbatim (fallback branch)', () => {
    const src = renderModule('9.9.9', null);
    expect(src).toContain('version: "9.9.9"');
    expect(src).toContain('markdown: null');
  });
});

describe('drift guard', () => {
  it('committed notes.generated.ts is byte-identical to regenerating from CHANGELOG.md + package.json', () => {
    const { source, version } = generate(repoRoot);
    const committed = readFileSync(
      join(repoRoot, 'src', 'lib', 'release-notes', 'notes.generated.ts'),
      'utf8',
    );
    expect(committed, 'run `pnpm notes:gen` and commit the result').toBe(source);
    // And the generated version is the real package.json version (no stale bump).
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(version).toBe(pkg.version);
  });
});
