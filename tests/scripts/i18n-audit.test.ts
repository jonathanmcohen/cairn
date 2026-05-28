import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditDirectory } from '../../scripts/i18n-audit';

function withFixture(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-audit-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    // Ensure parent dir exists for nested paths like ui/button.tsx.
    const parent = full.substring(0, full.lastIndexOf('/'));
    if (parent && parent !== dir) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(full, content, 'utf8');
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('i18n-audit', () => {
  it('flags raw JSX text', () => {
    const { dir, cleanup } = withFixture({
      'A.tsx': `
        export function A() { return <p>Hello world</p>; }
      `,
    });
    try {
      const r = auditDirectory(dir);
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]).toMatchObject({ text: 'Hello world', file: 'A.tsx' });
    } finally {
      cleanup();
    }
  });

  it('flags aria-label/placeholder/title/alt string literals', () => {
    const { dir, cleanup } = withFixture({
      'B.tsx': `
        export function B() {
          return (<>
            <button aria-label="Save changes">x</button>
            <input placeholder="Search pages" />
            <img alt="Cover" src="" />
            <a title="Open" href="#">x</a>
          </>);
        }
      `,
    });
    try {
      const r = auditDirectory(dir);
      const texts = r.findings.map((f) => f.text).sort();
      expect(texts).toEqual(['Cover', 'Open', 'Save changes', 'Search pages']);
    } finally {
      cleanup();
    }
  });

  it('ignores files under /ui/ (shadcn primitives)', () => {
    const { dir, cleanup } = withFixture({
      'ui/button.tsx': `export function B() { return <p>Primitive</p>; }`,
    });
    try {
      const r = auditDirectory(dir);
      expect(r.findings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('ignores t(...) and copy(...) calls', () => {
    const { dir, cleanup } = withFixture({
      'C.tsx': `
        const t = (k: string) => k;
        const copy = (k: string) => k;
        export function C() { return <p>{t('hello')}{copy('world')}</p>; }
      `,
    });
    try {
      const r = auditDirectory(dir);
      expect(r.findings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('ignores punctuation-only and unit-only literals', () => {
    const { dir, cleanup } = withFixture({
      'D.tsx': `
        export function D() { return <><p>—</p><span>12px</span><p>{','}</p></>; }
      `,
    });
    try {
      const r = auditDirectory(dir);
      expect(r.findings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('honors biome-ignore i18n: escape hatch on the same line', () => {
    const { dir, cleanup } = withFixture({
      'E.tsx': `
        export function E() {
          // biome-ignore i18n: brand name
          return <p>Cairn</p>;
        }
      `,
    });
    try {
      const r = auditDirectory(dir);
      expect(r.findings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('emits a stable sorted report', () => {
    const { dir, cleanup } = withFixture({
      'F.tsx': `export function F() { return <><p>bravo</p><p>alpha</p></>; }`,
    });
    try {
      const r1 = auditDirectory(dir);
      const r2 = auditDirectory(dir);
      expect(r1.findings.map((f) => f.text)).toEqual(['alpha', 'bravo']);
      expect(r1).toEqual(r2);
    } finally {
      cleanup();
    }
  });
});
