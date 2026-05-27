import { describe, expect, it } from 'vitest';
import { buildDocusaurusTree } from '@/lib/export/targets/docusaurus';

describe('buildDocusaurusTree', () => {
  it('emits docusaurus.config.js with workspace title + presets', () => {
    const tree = buildDocusaurusTree({
      workspaceName: 'Notes',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'Welcome',
          slug: 'welcome',
          navOrder: 0,
          depth: 0,
          markdown: '# hi',
        },
      ],
      assets: [],
      translationGroups: new Map(),
    });
    expect(tree.files['docusaurus.config.js']).toMatch(/title:\s*'Notes'/);
    expect(tree.files['docusaurus.config.js']).toMatch(/preset-classic/);
    expect(tree.files['docusaurus.config.js']).toMatch(/module\.exports\s*=/);
  });

  it('emits sidebars.js mirroring the page tree', () => {
    const tree = buildDocusaurusTree({
      workspaceName: 'Notes',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'Parent',
          slug: 'parent',
          navOrder: 0,
          depth: 0,
          markdown: 'body',
        },
        {
          id: 'p2',
          parentId: 'p1',
          title: 'Child',
          slug: 'child',
          navOrder: 1,
          depth: 1,
          markdown: 'body',
        },
      ],
      assets: [],
      translationGroups: new Map(),
    });
    const js = tree.files['sidebars.js'] as string;
    expect(js).toMatch(/module\.exports\s*=/);
    expect(js).toContain('parent');
    expect(js).toContain('child');
    // Parent appears with a `category` containing the child id.
    expect(js).toMatch(/type:\s*'category'/);
  });

  it('emits docs/<slug>.md with Docusaurus frontmatter (slug, sidebar_position, title)', () => {
    const tree = buildDocusaurusTree({
      workspaceName: 'Notes',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'Hi',
          slug: 'hi',
          navOrder: 5,
          depth: 0,
          markdown: '# h',
        },
      ],
      assets: [],
      translationGroups: new Map(),
    });
    const md = tree.files['docs/hi.md'] as string;
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/^id:\s*hi/m);
    expect(md).toMatch(/^slug:\s*\/hi/m);
    expect(md).toMatch(/^sidebar_position:\s*5/m);
    expect(md).toMatch(/^title:\s*Hi/m);
    expect(md).toContain('# h');
  });

  it('places assets under docs/assets/<filename>', () => {
    const tree = buildDocusaurusTree({
      workspaceName: 'Notes',
      pages: [],
      assets: [
        {
          fileId: 'f1',
          destFilename: 'f1-pic.png',
          mimeType: 'image/png',
          storagePath: 'k',
          contents: Buffer.from('PNG!'),
        },
      ],
      translationGroups: new Map(),
    });
    expect(Object.keys(tree.files)).toContain('docs/assets/f1-pic.png');
    expect(tree.files['docs/assets/f1-pic.png']).toBeInstanceOf(Buffer);
  });
});
