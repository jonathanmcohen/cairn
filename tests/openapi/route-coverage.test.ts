import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifest } from '@/lib/openapi/manifest';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

function toRoutePath(file: string): string {
  // src/app/api/v1/pages/[pageId]/route.ts -> /api/v1/pages/{pageId}
  return `/${file
    .replace(/^src\/app\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[\.\.\.([^\]]+)\]/g, '{$1}')
    .replace(/\[([^\]]+)\]/g, '{$1}')}`;
}

describe('openapi manifest coverage', () => {
  it('lists every v1 route handler under src/app/api/v1/**', async () => {
    const files = await walk('src/app/api/v1');
    const found = new Set<string>();
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      const path = toRoutePath(file);
      for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        // Match `export const GET = ...` or `export async function GET(...)` etc.
        const re = new RegExp(
          `export\\s+(?:(?:async\\s+)?function\\s+${m}\\b|(?:const|let|var)\\s+${m}\\b)`,
        );
        if (re.test(src)) {
          found.add(`${m} ${path}`);
        }
      }
    }
    const documented = new Set(manifest.map((e) => `${e.method} ${e.path}`));
    const missing = [...found].filter((f) => !documented.has(f));
    expect(missing, `${missing.length} v1 routes missing from manifest`).toEqual([]);
  });

  it('manifest references no routes outside src/app/api/v1', () => {
    const stray = manifest.filter((e) => !e.path.startsWith('/api/v1/'));
    expect(
      stray.map((s) => s.path),
      'all manifest entries must be /api/v1/*',
    ).toEqual([]);
  });
});
