import { dump as yamlDump } from 'js-yaml';
import type { AssetRef } from '../assets';
import { applyFrontmatter } from '../frontmatter';

export type RenderedPage = {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  depth: number;
  navOrder: number;
  markdown: string;
};

export type SiteTree = {
  files: Record<string, string | Buffer>;
};

/**
 * MkDocs nav supports nested arrays of `{title: filename}` entries; a parent
 * with children renders as `{title: [<self>, <child>, …]}`. We emit in walk
 * order, grouping children under their parent recursively.
 */
type NavEntry = Record<string, string | NavEntry[]>;

function buildNav(pages: RenderedPage[]): NavEntry[] {
  const childrenByParent = new Map<string | null, RenderedPage[]>();
  for (const p of pages) {
    const arr = childrenByParent.get(p.parentId) ?? [];
    arr.push(p);
    childrenByParent.set(p.parentId, arr);
  }
  function emit(parentId: string | null): NavEntry[] {
    const kids = childrenByParent.get(parentId) ?? [];
    return kids.map<NavEntry>((k) => {
      const grandkids = emit(k.id);
      if (grandkids.length === 0) {
        return { [k.title]: `${k.slug}.md` };
      }
      return { [k.title]: [{ Index: `${k.slug}.md` }, ...grandkids] };
    });
  }
  return emit(null);
}

/**
 * Build the MkDocs project file map: `mkdocs.yml`, one `docs/<slug>.md` per
 * page (with frontmatter), and `docs/assets/<filename>` for every bundled
 * asset. The orchestrator pre-renders markdown via proseToMarkdown so this
 * builder stays pure.
 */
export function buildMkDocsTree(args: {
  workspaceName: string;
  pages: RenderedPage[];
  assets: Array<AssetRef & { contents: Buffer }>;
}): SiteTree {
  const files: Record<string, string | Buffer> = {};
  for (const p of args.pages) {
    files[`docs/${p.slug}.md`] = applyFrontmatter(
      'mkdocs',
      { id: p.id, title: p.title, slug: p.slug, navOrder: p.navOrder, depth: p.depth },
      p.markdown,
    );
  }
  for (const a of args.assets) {
    files[`docs/assets/${a.destFilename}`] = a.contents;
  }
  files['mkdocs.yml'] = yamlDump({
    site_name: args.workspaceName,
    docs_dir: 'docs',
    nav: buildNav(args.pages),
    theme: { name: 'material' },
  });
  return { files };
}
