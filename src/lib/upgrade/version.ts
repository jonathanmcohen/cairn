/**
 * Read the bundled `package.json#version` at runtime.
 *
 * Centralized here so the admin page (RSC) and the status route share one
 * source of truth and degrade the same way (`unknown`) if package.json is
 * unreachable in some constrained build.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let cached: string | null = null;

export async function readPackageVersion(): Promise<string> {
  if (cached !== null) return cached;
  try {
    const raw = await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    cached = pkg.version ?? process.env.npm_package_version ?? 'unknown';
  } catch {
    cached = process.env.npm_package_version ?? 'unknown';
  }
  return cached;
}
