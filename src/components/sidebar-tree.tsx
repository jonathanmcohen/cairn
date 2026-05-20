import { getDb } from '@/db/client';
import { type PageTreeNode, getPageTree } from '@/lib/pages/tree';
import type { Route } from 'next';
import Link from 'next/link';

export async function SidebarTree({ workspaceId }: { workspaceId: string }) {
  const tree = await getPageTree(getDb(), workspaceId);
  if (tree.length === 0) {
    return <p className="px-2 py-4 text-sm text-muted-foreground">No pages yet.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <TreeItem key={node.id} node={node} depth={0} />
      ))}
    </ul>
  );
}

function TreeItem({ node, depth }: { node: PageTreeNode; depth: number }) {
  return (
    <li>
      <Link
        href={`/pages/${node.id}` as Route}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-4 shrink-0 text-center">{node.icon ?? '📄'}</span>
        <span className="truncate">{node.title}</span>
      </Link>
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
