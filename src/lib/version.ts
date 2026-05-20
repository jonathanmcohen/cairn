import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function appVersion(): string {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // From src/lib in dev, .next/standalone/... in prod.
  const candidates = [
    join(here, '..', '..', 'package.json'),
    join(here, '..', '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const json = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
      if (json.version) {
        cached = json.version;
        return cached;
      }
    } catch {
      // try next candidate path
    }
  }
  cached = '0.0.0';
  return cached;
}
