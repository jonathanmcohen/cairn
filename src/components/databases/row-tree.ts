export type TreeRow = { id: string; parentRowId: string | null };

export type ForestNode<T extends TreeRow> = {
  row: T;
  depth: number;
  children: ForestNode<T>[];
};

export type VisibleNode<T extends TreeRow = TreeRow> = {
  row: T;
  depth: number;
  hasChildren: boolean;
};

/**
 * Build a forest from a flat, ordered row list using `parentRowId`. A row whose
 * parent id is not present in the list (e.g. filtered out) is promoted to a
 * root. Sibling/root order follows the input order. Cyclic data (which write-time
 * validation forbids) yields nodes that are never reachable from any root, so it
 * is simply omitted — the function never loops.
 */
export function buildRowForest<T extends TreeRow>(rows: T[]): ForestNode<T>[] {
  const nodes = new Map<string, ForestNode<T>>();
  for (const row of rows) {
    nodes.set(row.id, { row, depth: 0, children: [] });
  }
  const roots: ForestNode<T>[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent =
      row.parentRowId !== null && row.parentRowId !== row.id
        ? nodes.get(row.parentRowId)
        : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // Assign depth from the roots (so unreachable cyclic nodes are excluded).
  const reachable: ForestNode<T>[] = [];
  const assign = (node: ForestNode<T>, depth: number, seen: Set<string>) => {
    if (seen.has(node.row.id)) return; // defensive against cycles
    seen.add(node.row.id);
    node.depth = depth;
    reachable.push(node);
    for (const child of node.children) assign(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const root of roots) assign(root, 0, seen);
  // A root reached only through a cycle filter: roots are by construction parentless
  // or self-referential, so the roots array is the true forest. Return it directly.
  return roots.filter((n) => seen.has(n.row.id));
}

/**
 * Depth-first list of visible nodes. A node id present in `collapsed` keeps the
 * node visible but hides its descendants.
 */
export function flattenVisible<T extends TreeRow>(
  forest: ForestNode<T>[],
  collapsed: ReadonlySet<string>,
): VisibleNode<T>[] {
  const out: VisibleNode<T>[] = [];
  const walk = (node: ForestNode<T>) => {
    out.push({ row: node.row, depth: node.depth, hasChildren: node.children.length > 0 });
    if (collapsed.has(node.row.id)) return;
    for (const child of node.children) walk(child);
  };
  for (const root of forest) walk(root);
  return out;
}
