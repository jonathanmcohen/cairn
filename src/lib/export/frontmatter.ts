import matter from 'gray-matter';

export type ExportTarget = 'mkdocs' | 'docusaurus';

export type FrontmatterInput = {
  id: string;
  title: string;
  slug: string;
  /**
   * MkDocs `nav_order` / Docusaurus `sidebar_position`. The orchestrator
   * derives this from depth-first walk index (the canonical insertion order
   * on the pages table — there is no explicit `position` column).
   */
  navOrder: number;
  depth: number;
};

function buildMkdocs(input: FrontmatterInput): Record<string, unknown> {
  return {
    title: input.title,
    nav_order: input.navOrder,
  };
}

function buildDocusaurus(input: FrontmatterInput): Record<string, unknown> {
  // Placeholder for P35 — exports the field shape so P35's diff is purely
  // additive. P34's orchestrator + API never route through this branch.
  return {
    id: input.slug,
    slug: `/${input.slug}`,
    title: input.title,
    sidebar_position: input.navOrder,
  };
}

/**
 * Prepends a YAML frontmatter block to a page body, in the shape expected by
 * the named target's site generator.
 */
export function applyFrontmatter(
  target: ExportTarget,
  input: FrontmatterInput,
  body: string,
): string {
  let data: Record<string, unknown>;
  switch (target) {
    case 'mkdocs':
      data = buildMkdocs(input);
      break;
    case 'docusaurus':
      data = buildDocusaurus(input);
      break;
    default: {
      const _exhaustive: never = target;
      throw new Error(`unknown export target: ${String(_exhaustive)}`);
    }
  }
  return matter.stringify(body, data);
}
