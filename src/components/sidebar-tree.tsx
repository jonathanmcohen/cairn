import { getDb } from '@/db/client';
import { getPageTree, type PageTreeNode } from '@/lib/pages/tree';
import { SidebarTreeItem } from './sidebar-tree-item';

export async function SidebarTree({ workspaceId }: { workspaceId: string }) {
  const tree = await getPageTree(getDb(), workspaceId);
  if (tree.length === 0) {
    return <p className="px-2 py-4 text-sm text-muted-foreground">No pages yet.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <SidebarTreeItem key={node.id} node={node} depth={0} />
      ))}
    </ul>
  );
}

export type { PageTreeNode };
