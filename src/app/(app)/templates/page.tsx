import { asc, desc, eq, or } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type TemplateCard, TemplatesGallery } from '@/components/templates/templates-gallery';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';

export default async function TemplatesPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  // Built-in (global) templates are visible to everyone; workspace templates
  // only to their own workspace. Built-ins float to the top.
  const rows = await getDb()
    .select({
      id: schema.templates.id,
      name: schema.templates.name,
      kind: schema.templates.kind,
      builtIn: schema.templates.builtIn,
    })
    .from(schema.templates)
    .where(
      or(eq(schema.templates.builtIn, true), eq(schema.templates.workspaceId, ctx.workspaceId)),
    )
    .orderBy(desc(schema.templates.builtIn), asc(schema.templates.name));

  const templates: TemplateCard[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind === 'database' ? 'database' : 'page',
    builtIn: r.builtIn,
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-2 text-3xl font-semibold">Templates</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Start from a built-in or workspace template. &ldquo;Use template&rdquo; copies it into this
        workspace with fresh pages and databases, then opens the new copy. Save any page or database
        as a template from its menu.
      </p>
      <TemplatesGallery initialTemplates={templates} />
    </div>
  );
}
