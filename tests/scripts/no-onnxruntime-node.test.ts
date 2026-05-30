import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

describe('onnxruntime-node is fully removed (#136)', () => {
  it('is not a dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['onnxruntime-node']).toBeUndefined();
    expect(pkg.devDependencies?.['onnxruntime-node']).toBeUndefined();
  });

  it('is not in the pnpm allowBuilds map', () => {
    const ws = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(ws).not.toMatch(/onnxruntime-node/);
  });

  it('is not imported by any source file', () => {
    // git grep returns exit code 1 (no matches) on success here.
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-l', 'onnxruntime-node', '--', 'src', 'collab'], {
        cwd: root,
        encoding: 'utf8',
      });
    } catch {
      out = '';
    }
    expect(out.trim()).toBe('');
  });
});
