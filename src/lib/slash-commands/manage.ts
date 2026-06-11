import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { TemplatePayloadSchema } from '@/lib/templates/payload';
import { isBuiltinSlashTrigger } from './builtin-triggers';

type Db = PostgresJsDatabase<typeof schema>;

export type SlashCommandErrorCode =
  | 'INVALID_TRIGGER'
  | 'BUILTIN_TRIGGER'
  | 'DUPLICATE_TRIGGER'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_NOT_INSERTABLE'
  | 'NOT_FOUND';

export class SlashCommandError extends Error {
  constructor(
    public code: SlashCommandErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SlashCommandError';
  }
}

/** Trigger format: the command word WITHOUT the leading slash. Mirrors the
 *  CHECK constraint in migration 0075. */
export const SLASH_TRIGGER_RE = /^[a-z0-9-]{2,32}$/;

/** One row of the workspace's custom slash-command list, template name joined
 *  in for the settings UI. */
export type WorkspaceSlashCommandRow = {
  id: string;
  trigger: string;
  label: string;
  templateId: string;
  templateName: string;
  enabled: boolean;
  createdAt: Date;
};

/**
 * Extract the cursor-insertable content of a template payload: the root
 * page's ProseMirror `doc.content` node array.
 *
 * v1 scope (documented): only `kind: 'page'` templates are insertable, and a
 * multi-page template contributes its ROOT page's content only (sub-pages and
 * databases need `instantiateTemplate`'s id-remapping — out of slash-insert
 * scope). Returns null when the payload is malformed or has no root content;
 * callers treat null as "nothing to insert".
 */
export function extractTemplateInsertContent(payload: unknown): unknown[] | null {
  const parsed = TemplatePayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.kind !== 'page') return null;
  const root =
    parsed.data.pages.find((p) => p.id === parsed.data.rootPageId) ?? parsed.data.pages[0];
  if (!root) return null;
  const doc = root.content as { type?: string; content?: unknown[] } | null | undefined;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return null;
  return doc.content.length > 0 ? doc.content : null;
}

/** List a workspace's slash commands (settings + editor menu source). */
export async function listSlashCommands(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceSlashCommandRow[]> {
  return db
    .select({
      id: schema.workspaceSlashCommands.id,
      trigger: schema.workspaceSlashCommands.trigger,
      label: schema.workspaceSlashCommands.label,
      templateId: schema.workspaceSlashCommands.templateId,
      templateName: schema.templates.name,
      enabled: schema.workspaceSlashCommands.enabled,
      createdAt: schema.workspaceSlashCommands.createdAt,
    })
    .from(schema.workspaceSlashCommands)
    .innerJoin(schema.templates, eq(schema.workspaceSlashCommands.templateId, schema.templates.id))
    .where(eq(schema.workspaceSlashCommands.workspaceId, workspaceId))
    .orderBy(asc(schema.workspaceSlashCommands.trigger));
}

export type CreateSlashCommandInput = {
  workspaceId: string;
  actorUserId: string;
  trigger: string;
  label: string;
  templateId: string;
};

/**
 * Create a workspace slash command. Validation order (each throws a typed
 * `SlashCommandError`):
 *   1. format        — lowercase `[a-z0-9-]{2,32}` (input is lowercased+trimmed
 *                      first, so `MyCmd ` normalizes rather than failing);
 *   2. built-in      — must not shadow the built-in slash vocabulary
 *                      (`BUILTIN_SLASH_TRIGGERS`);
 *   3. template      — must exist AND belong to this workspace (tenant guard;
 *                      foreign/built-in-global templates 404 as NOT FOUND so
 *                      existence never leaks) AND be `kind: 'page'` with
 *                      extractable content (database templates need
 *                      instantiate, not cursor-insert);
 *   4. duplicate     — one meaning per trigger per workspace.
 * Insert + audit are one transaction (house rule: audit never drifts).
 */
export async function createSlashCommand(
  db: Db,
  input: CreateSlashCommandInput,
): Promise<WorkspaceSlashCommandRow> {
  const trigger = input.trigger.trim().toLowerCase();
  const label = input.label.trim();
  if (!SLASH_TRIGGER_RE.test(trigger)) {
    throw new SlashCommandError(
      'INVALID_TRIGGER',
      'Trigger must be 2-32 characters: lowercase letters, digits, hyphens',
    );
  }
  if (isBuiltinSlashTrigger(trigger)) {
    throw new SlashCommandError('BUILTIN_TRIGGER', `"/${trigger}" is a built-in slash command`);
  }
  if (label.length === 0) {
    throw new SlashCommandError('INVALID_TRIGGER', 'Label is required');
  }

  const [template] = await db
    .select({
      id: schema.templates.id,
      name: schema.templates.name,
      kind: schema.templates.kind,
      payload: schema.templates.payload,
    })
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, input.templateId),
        eq(schema.templates.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!template) {
    throw new SlashCommandError('TEMPLATE_NOT_FOUND', 'Template not found in this workspace');
  }
  if (template.kind !== 'page' || extractTemplateInsertContent(template.payload) === null) {
    throw new SlashCommandError(
      'TEMPLATE_NOT_INSERTABLE',
      'Only page templates with content can back a slash command',
    );
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.workspaceSlashCommands.id })
      .from(schema.workspaceSlashCommands)
      .where(
        and(
          eq(schema.workspaceSlashCommands.workspaceId, input.workspaceId),
          eq(schema.workspaceSlashCommands.trigger, trigger),
        ),
      )
      .limit(1);
    if (existing) {
      throw new SlashCommandError(
        'DUPLICATE_TRIGGER',
        `"/${trigger}" is already defined in this workspace`,
      );
    }

    const [row] = await tx
      .insert(schema.workspaceSlashCommands)
      .values({
        workspaceId: input.workspaceId,
        trigger,
        label,
        templateId: template.id,
      })
      .returning();
    if (!row) throw new Error('failed to create slash command');

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.slash_command_created',
      targetType: 'workspace_slash_command',
      targetId: row.id,
      metadata: { trigger, label, templateId: template.id },
    });

    return {
      id: row.id,
      trigger: row.trigger,
      label: row.label,
      templateId: row.templateId,
      templateName: template.name,
      enabled: row.enabled,
      createdAt: row.createdAt,
    };
  });
}

export type DeleteSlashCommandInput = {
  workspaceId: string;
  actorUserId: string;
  commandId: string;
};

/**
 * Delete a workspace slash command. Workspace-scoped, so a cross-workspace id
 * no-ops into NOT_FOUND (no existence leak). Delete + audit are one
 * transaction.
 */
export async function deleteSlashCommand(db: Db, input: DeleteSlashCommandInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(schema.workspaceSlashCommands)
      .where(
        and(
          eq(schema.workspaceSlashCommands.id, input.commandId),
          eq(schema.workspaceSlashCommands.workspaceId, input.workspaceId),
        ),
      )
      .returning();
    if (!row) throw new SlashCommandError('NOT_FOUND', 'Slash command not found');

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.slash_command_deleted',
      targetType: 'workspace_slash_command',
      targetId: row.id,
      metadata: { trigger: row.trigger, label: row.label },
    });
  });
}
