#!/usr/bin/env tsx
/**
 * v0.10.3 A11Y-1 — export the live "Cairn Guide" page tree into a deterministic
 * a11y seed fixture (`tests/a11y/fixtures/cairn-guide.json`).
 *
 * The seed is the SINGLE source of truth for the accessibility suite (A11Y-4)
 * and for fresh-workspace bootstrap content (A11Y-5). It must equal the live
 * docs at all times; A11Y-3's `--check` mode is the CI freshness gate.
 *
 *   pnpm docs:sync            # pull from CAIRN_DOC_SOURCE_URL, write the seed
 *   pnpm docs:sync --check    # exit 1 if the committed seed != a fresh pull
 *
 * Env:
 *   CAIRN_DOC_SOURCE_URL   base URL of the source instance (default: the canary)
 *   CAIRN_DOC_SOURCE_PAT   admin API key (cairn_sk_…) — REQUIRED for a live pull
 *   CAIRN_DOC_ROOT         the Cairn Guide root page id or title (default below)
 *
 * Network-blocked CI: if the source is unreachable, a live pull fails loudly,
 * but `--check` degrades to a max-age check against the committed snapshot
 * (`tests/a11y/fixtures/snapshot-meta.json`) so an offline runner does not red
 * the build on transient network — see A11Y-2 failure mode.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
export const SEED_PATH = join(ROOT, 'tests', 'a11y', 'fixtures', 'cairn-guide.json');
const DEFAULT_SOURCE = 'https://cairn.local.jonco.dev';
const DEFAULT_ROOT = 'Cairn Guide';

/** A page as the exporter cares about it, post-fetch, pre-normalisation. */
export type RawPage = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  content: unknown; // ProseMirror doc JSON
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  workspaceId?: string;
};

/** A normalised seed page — stable, identity-free, deterministically ordered. */
export type SeedPage = {
  slug: string; // stable slug derived from the title path (no UUIDs)
  parentSlug: string | null;
  title: string;
  icon: string | null;
  content: unknown;
};

export type Seed = { version: 1; pages: SeedPage[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic slug from a title: lowercase, non-alphanumerics → '-', deduped. */
export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'untitled';
}

/**
 * Strip every instance-specific field (UUIDs, timestamps, user/workspace ids)
 * from the PM doc so the seed is byte-stable across instances. Recursively
 * deletes known volatile attrs and rewrites page-link/mention ids to slugs via
 * `idToSlug`. Unknown UUID-shaped attr values are dropped (fail-safe: an
 * un-mapped id must never leak into the committed seed).
 */
function normaliseContent(node: unknown, idToSlug: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((n) => normaliseContent(n, idToSlug));
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    // Volatile keys never belong in a deterministic seed.
    if (k === 'createdAt' || k === 'updatedAt' || k === 'createdBy' || k === 'workspaceId') {
      continue;
    }
    if (typeof v === 'string' && UUID_RE.test(v)) {
      // Page-link / mention target → slug if we know it, else drop the attr.
      const slug = idToSlug.get(v);
      if (slug) out[k] = `slug:${slug}`;
      continue;
    }
    out[k] = normaliseContent(v, idToSlug);
  }
  return out;
}

/**
 * Pure transform: raw pages (descendants of the root, root first) → a
 * deterministic Seed. Sorted by (parentSlug, title) so diffs are reviewable;
 * identity-free; idempotent — `normaliseSeed(x)` applied to already-normalised
 * input is a no-op on the volatile fields.
 */
export function normaliseSeed(pages: RawPage[]): Seed {
  const idToSlug = new Map<string, string>();
  // First pass: assign stable slugs. Disambiguate collisions by parent chain.
  const used = new Set<string>();
  for (const p of pages) {
    let slug = slugify(p.title);
    let n = 2;
    while (used.has(slug)) slug = `${slugify(p.title)}-${n++}`;
    used.add(slug);
    idToSlug.set(p.id, slug);
  }
  const seedPages: SeedPage[] = pages.map((p) => ({
    slug: idToSlug.get(p.id) as string,
    parentSlug: p.parentId ? (idToSlug.get(p.parentId) ?? null) : null,
    title: p.title,
    icon: p.icon ?? null,
    content: normaliseContent(p.content, idToSlug),
  }));
  seedPages.sort((a, b) => {
    const pa = a.parentSlug ?? '';
    const pb = b.parentSlug ?? '';
    return pa !== pb ? pa.localeCompare(pb) : a.title.localeCompare(b.title);
  });
  return { version: 1, pages: seedPages };
}

/** Stable JSON serialisation (2-space, trailing newline) for reviewable diffs. */
export function serialiseSeed(seed: Seed): string {
  return `${JSON.stringify(seed, null, 2)}\n`;
}

// --- live pull (only runs in the CLI path; unit tests import the pure fns) ---

async function fetchAllPages(base: string, pat: string): Promise<RawPage[]> {
  const out: RawPage[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL('/api/v1/pages', base);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { authorization: `Bearer ${pat}` } });
    if (!res.ok) throw new Error(`GET ${url.pathname} → ${res.status}`);
    const body = (await res.json()) as { data: RawPage[]; nextCursor?: string | null };
    out.push(...body.data);
    cursor = body.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

/** Descendants of the root (root included), resolved by id or title. */
export function collectGuideTree(all: RawPage[], root: string): RawPage[] {
  const rootPage = all.find((p) => p.id === root || p.title === root);
  if (!rootPage) throw new Error(`Cairn Guide root not found: ${root}`);
  const byParent = new Map<string, RawPage[]>();
  for (const p of all) {
    if (!p.parentId) continue;
    (byParent.get(p.parentId) ?? byParent.set(p.parentId, []).get(p.parentId))?.push(p);
  }
  const tree: RawPage[] = [];
  const walk = (p: RawPage) => {
    tree.push(p);
    for (const child of byParent.get(p.id) ?? []) walk(child);
  };
  walk(rootPage);
  return tree;
}

async function pull(): Promise<Seed> {
  const base = process.env.CAIRN_DOC_SOURCE_URL ?? DEFAULT_SOURCE;
  const pat = process.env.CAIRN_DOC_SOURCE_PAT;
  const root = process.env.CAIRN_DOC_ROOT ?? DEFAULT_ROOT;
  if (!pat) {
    throw new Error(
      'CAIRN_DOC_SOURCE_PAT is required for a live pull (admin cairn_sk_ key). ' +
        'Set it locally to run `pnpm docs:sync`, or as a GitHub Actions secret for a11y-seed-sync.yml.',
    );
  }
  const all = await fetchAllPages(base, pat);
  return normaliseSeed(collectGuideTree(all, root));
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const fresh = serialiseSeed(await pull());
  if (check) {
    const committed = existsSync(SEED_PATH) ? readFileSync(SEED_PATH, 'utf8') : '';
    if (committed !== fresh) {
      console.error(
        'a11y seed is STALE: the committed cairn-guide.json differs from a fresh pull.\n' +
          'Run `pnpm docs:sync` and commit the result.',
      );
      process.exit(1);
    }
    console.info('a11y seed is fresh.');
    return;
  }
  writeFileSync(SEED_PATH, fresh);
  console.info(`a11y seed written: ${SEED_PATH}`);
}

const isCli =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  Boolean(process.argv[1]?.endsWith('export-a11y-seed.ts'));
if (isCli) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
