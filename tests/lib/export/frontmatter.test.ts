import { describe, expect, it } from 'vitest';
import { applyFrontmatter } from '@/lib/export/frontmatter';

describe('applyFrontmatter (mkdocs)', () => {
  it('prepends YAML frontmatter with title + nav_order', () => {
    const out = applyFrontmatter(
      'mkdocs',
      { id: 'p1', title: 'My Page', slug: 'my-page', navOrder: 3, depth: 1 },
      '# Hello\n\nbody',
    );
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toMatch(/title:\s*My Page/);
    expect(out).toMatch(/nav_order:\s*3/);
    expect(out).toMatch(/\n---\n/);
    expect(out).toContain('# Hello');
  });

  it("escapes single quotes in titles via gray-matter's safe-dump", () => {
    const out = applyFrontmatter(
      'mkdocs',
      { id: 'p1', title: "Bob's page", slug: 'bobs-page', navOrder: 0, depth: 0 },
      'body',
    );
    expect(out).toMatch(/title:\s*("Bob's page"|Bob's page)/);
  });

  it('rejects unknown targets', () => {
    expect(() =>
      applyFrontmatter(
        'lol' as never,
        { id: 'p1', title: 't', slug: 's', navOrder: 0, depth: 0 },
        'b',
      ),
    ).toThrow();
  });
});

describe('applyFrontmatter (docusaurus)', () => {
  it('uses the docusaurus field shape (id, slug, sidebar_position)', () => {
    const out = applyFrontmatter(
      'docusaurus',
      { id: 'p1', title: 'Doc', slug: 'doc', navOrder: 5, depth: 0 },
      'body',
    );
    expect(out).toMatch(/^---\n/);
    expect(out).toMatch(/title:\s*Doc/);
    expect(out).toMatch(/sidebar_position:\s*5/);
    expect(out).toMatch(/slug:\s*\/doc/);
  });
});
