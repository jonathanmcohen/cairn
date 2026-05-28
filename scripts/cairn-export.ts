#!/usr/bin/env tsx
/**
 * Cairn static-site export CLI. Pure orchestration: parse args, call
 * exportWorkspace, stream to fs. Run via either:
 *
 *   pnpm exec tsx scripts/cairn-export.ts --workspace <uuid> --target mkdocs --out out.zip
 *   pnpm export:static -- --workspace <uuid> --target mkdocs --out out.zip
 *
 * Wraps the same v0.9.0 G7 P34 pipeline that powers
 * POST /api/exports/static-site.
 */
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { getDb } from '@/db/client';
import { exportWorkspace, StaticExportError } from '@/lib/export/static-site';

type Target = 'mkdocs' | 'docusaurus';
type Args = { workspace?: string; target?: Target; out?: string };

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--workspace' && v) {
      out.workspace = v;
      i++;
    } else if (a === '--target' && (v === 'mkdocs' || v === 'docusaurus')) {
      out.target = v;
      i++;
    } else if (a === '--out' && v) {
      out.out = v;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workspace || !args.target || !args.out) {
    process.stderr.write(
      'usage: cairn-export --workspace <uuid> --target mkdocs|docusaurus --out path.zip\n',
    );
    process.exit(2);
  }
  try {
    const db = getDb();
    const stream = await exportWorkspace(db, {
      workspaceId: args.workspace,
      target: args.target,
    });
    await pipeline(stream, createWriteStream(args.out));
    process.stderr.write(`wrote ${args.out}\n`);
  } catch (err) {
    if (err instanceof StaticExportError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

void main();
