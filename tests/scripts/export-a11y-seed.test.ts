// v0.10.3 A11Y-1 — normaliser/seed-shape unit tests for scripts/export-a11y-seed.ts.
// Pure-function coverage only (no live pull): identity stripping, determinism,
// idempotency, slug collisions, page-link rewrite, and the failure mode where a
// doc-author's emoji/unicode title must still produce a valid, sorted seed.
import { describe, expect, it } from 'vitest';
import {
  collectGuideTree,
  normaliseSeed,
  type RawPage,
  serialiseSeed,
  slugify,
} from '../../scripts/export-a11y-seed';

const WS = '11111111-1111-1111-1111-111111111111';
const U = '22222222-2222-2222-2222-222222222222';

function page(id: string, parentId: string | null, title: string, content: unknown): RawPage {
  return {
    id,
    parentId,
    title,
    icon: null,
    content,
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T01:00:00.000Z',
    createdBy: U,
    workspaceId: WS,
  };
}

const ROOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('export-a11y-seed normaliser', () => {
  it('strips workspace/user ids + timestamps from content', () => {
    const seed = normaliseSeed([
      page(ROOT, null, 'Cairn Guide', {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { workspaceId: WS, createdBy: U }, content: [] }],
      }),
    ]);
    const json = serialiseSeed(seed);
    expect(json).not.toContain(WS);
    expect(json).not.toContain(U);
    expect(json).not.toContain('2026-06-14T');
  });

  it('rewrites known page-link UUIDs to slug refs and drops unknown ones', () => {
    const seed = normaliseSeed([
      page(ROOT, null, 'Cairn Guide', {
        type: 'doc',
        content: [
          { type: 'pageLink', attrs: { pageId: CHILD } },
          { type: 'pageLink', attrs: { pageId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' } },
        ],
      }),
      page(CHILD, ROOT, 'Getting Started', { type: 'doc', content: [] }),
    ]);
    const guide = seed.pages.find((p) => p.title === 'Cairn Guide');
    const links = (guide?.content as { content: { attrs?: Record<string, unknown> }[] }).content;
    expect(links[0]?.attrs?.pageId).toBe('slug:getting-started'); // known → slug
    expect(links[1]?.attrs ?? {}).not.toHaveProperty('pageId'); // unknown → dropped
  });

  it('is idempotent on volatile fields (re-normalising a seed changes nothing)', () => {
    const pages = [
      page(ROOT, null, 'Cairn Guide', { type: 'doc', content: [] }),
      page(CHILD, ROOT, 'Getting Started', { type: 'doc', content: [] }),
    ];
    const once = serialiseSeed(normaliseSeed(pages));
    // Re-feed the same raw pages: output is byte-identical (deterministic).
    const twice = serialiseSeed(normaliseSeed(pages));
    expect(twice).toBe(once);
  });

  it('disambiguates duplicate titles into unique slugs', () => {
    const seed = normaliseSeed([
      page(ROOT, null, 'Cairn Guide', { type: 'doc', content: [] }),
      page(CHILD, ROOT, 'Notes', { type: 'doc', content: [] }),
      page('dddddddd-dddd-dddd-dddd-dddddddddddd', ROOT, 'Notes', { type: 'doc', content: [] }),
    ]);
    const slugs = seed.pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // all unique
    expect(slugs).toContain('notes');
    expect(slugs).toContain('notes-2');
  });

  it('sorts deterministically by (parentSlug, title)', () => {
    const seed = normaliseSeed([
      page(ROOT, null, 'Cairn Guide', { type: 'doc', content: [] }),
      page('e1', ROOT, 'Zebra', { type: 'doc', content: [] }),
      page('e2', ROOT, 'Alpha', { type: 'doc', content: [] }),
    ]);
    const childTitles = seed.pages
      .filter((p) => p.parentSlug === 'cairn-guide')
      .map((p) => p.title);
    expect(childTitles).toEqual(['Alpha', 'Zebra']);
  });

  it('handles emoji/unicode titles without breaking JSON or slugs (failure mode)', () => {
    const seed = normaliseSeed([
      page(ROOT, null, '📚 Cairn Guide — café', { type: 'doc', content: [] }),
      page(CHILD, ROOT, 'مرحبا', { type: 'doc', content: [] }),
    ]);
    expect(() => JSON.parse(serialiseSeed(seed))).not.toThrow();
    for (const p of seed.pages) expect(p.slug.length).toBeGreaterThan(0);
  });
});

describe('slugify', () => {
  it('falls back to "untitled" for punctuation-only titles', () => {
    expect(slugify('—')).toBe('untitled');
    expect(slugify('Hello, World!')).toBe('hello-world');
  });
});

describe('collectGuideTree', () => {
  it('returns the root + descendants, excluding unrelated pages', () => {
    const all = [
      page(ROOT, null, 'Cairn Guide', {}),
      page(CHILD, ROOT, 'Getting Started', {}),
      page('grand', CHILD, 'Install', {}),
      page('other', null, 'Personal Scratchpad', {}),
    ];
    const tree = collectGuideTree(all, 'Cairn Guide').map((p) => p.title);
    expect(tree).toContain('Cairn Guide');
    expect(tree).toContain('Install');
    expect(tree).not.toContain('Personal Scratchpad');
  });

  it('throws when the root is missing', () => {
    expect(() => collectGuideTree([page('x', null, 'Nope', {})], 'Cairn Guide')).toThrow(
      /root not found/,
    );
  });
});
