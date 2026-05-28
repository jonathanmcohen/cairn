import { redirect } from 'next/navigation';
import { type TemplateCard, TemplatesGallery } from '@/components/templates/templates-gallery';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listVisibleTemplates } from '@/lib/templates/access';

export default async function TemplatesPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  // v0.9 G4 P25 — gallery now sources from the visibility ACL: public rows
  // (including builtins where workspaceId IS NULL) plus workspace/private rows
  // belonging to any workspace the viewer is a member of. The component groups
  // by visibility tier for rendering.
  const rows = await listVisibleTemplates(getDb(), {
    viewerUserId: ctx.userId,
    viewerWorkspaceId: ctx.workspaceId,
  });

  // Sort: builtins first (legacy expectation), then alphabetic by name.
  const sorted = [...rows].sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const templates: TemplateCard[] = sorted.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind === 'database' ? 'database' : 'page',
    builtIn: r.builtIn,
    visibility: r.visibility,
    workspaceId: r.workspaceId,
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-2 text-3xl font-semibold">Templates</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Start from a built-in or workspace template. &ldquo;Use template&rdquo; copies it into this
        workspace with fresh pages and databases, then opens the new copy. Save any page or database
        as a template from its menu.
      </p>
      <TemplatesGallery initialTemplates={templates} activeWorkspaceId={ctx.workspaceId} />
    </div>
  );
}
