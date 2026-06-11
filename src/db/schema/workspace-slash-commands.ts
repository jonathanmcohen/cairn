import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { templates } from './templates';
import { workspaces } from './workspaces';

/**
 * v0.10.0 F2 — custom slash commands → templates.
 *
 * A workspace admin binds a `trigger` word (typed as `/<trigger>` in the
 * editor) to a saved workspace template. Picking the command in the slash
 * menu inserts the template's root-page content at the cursor through the
 * normal `insertContent` pipeline (collab-safe).
 *
 * - `trigger` is stored WITHOUT the leading slash, lowercase
 *   `[a-z0-9-]{2,32}`. The format is validated in
 *   `src/lib/slash-commands/manage.ts` and backed by a CHECK constraint
 *   declared in migration 0075 (Drizzle's callback form doesn't model CHECKs
 *   — the templates.visibility precedent).
 * - `templateId` cascades: deleting the template deletes the command row, so
 *   a dead template can never leave a slash command that inserts nothing
 *   (the command simply disappears from the menu — no broken-flag state).
 * - UNIQUE(workspace_id, trigger): one meaning per trigger per workspace.
 */
export const workspaceSlashCommands = pgTable(
  'workspace_slash_commands',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceTriggerUnique: uniqueIndex('workspace_slash_commands_workspace_trigger_unique').on(
      t.workspaceId,
      t.trigger,
    ),
    byTemplateIdx: index('workspace_slash_commands_template_id_idx').on(t.templateId),
  }),
);

export type WorkspaceSlashCommand = typeof workspaceSlashCommands.$inferSelect;
export type NewWorkspaceSlashCommand = typeof workspaceSlashCommands.$inferInsert;
