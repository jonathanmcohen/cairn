import { and, asc, eq } from 'drizzle-orm';
import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { listSlashCommands } from '@/lib/slash-commands/manage';
import { SlashCommandsManager } from './slash-commands-manager';

/**
 * v0.10.0 F2 — Admin-only "Slash commands" console: bind /trigger words to
 * saved page templates so members can insert them from the editor's slash
 * menu (Workspace group).
 *
 * The settings layout gates on admin already; `requireRole('admin')` is
 * repeated for defense-in-depth (the pinned-pages sibling's convention). The
 * template picker offers this workspace's PAGE templates only — database
 * templates need full instantiation and can't be cursor-inserted (the manage
 * lib rejects them too).
 */
export default async function SlashCommandsAdminPage() {
  const ctx = await requireRole('admin');
  const db = getDb();
  const [commands, templates] = await Promise.all([
    listSlashCommands(db, ctx.workspaceId),
    db
      .select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(
        and(eq(schema.templates.workspaceId, ctx.workspaceId), eq(schema.templates.kind, 'page')),
      )
      .orderBy(asc(schema.templates.name)),
  ]);

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Slash commands"
      />
      <SlashCommandsManager
        workspaceId={ctx.workspaceId}
        commands={commands.map((c) => ({
          id: c.id,
          trigger: c.trigger,
          label: c.label,
          templateName: c.templateName,
        }))}
        templates={templates}
      />
    </section>
  );
}
