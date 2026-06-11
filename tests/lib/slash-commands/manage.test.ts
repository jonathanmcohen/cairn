import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  createSlashCommand,
  deleteSlashCommand,
  extractTemplateInsertContent,
  listSlashCommands,
  SlashCommandError,
} from '@/lib/slash-commands/manage';
import { startPostgres, stopPostgres } from '../../helpers/db';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE audit_log, workspace_slash_commands, templates, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function user(name = 'u') {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function ws(name = 'WS') {
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name, slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}

const PAGE_PAYLOAD = {
  kind: 'page',
  rootPageId: 'p1',
  pages: [
    {
      id: 'p1',
      parentId: null,
      title: 'Tpl',
      icon: null,
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tpl body' }] }],
      },
    },
  ],
  databases: [],
};

async function template(
  workspaceId: string | null,
  overrides: { kind?: string; payload?: unknown; name?: string } = {},
) {
  const [t] = await db
    .insert(schema.templates)
    .values({
      workspaceId,
      name: overrides.name ?? 'Tpl',
      kind: overrides.kind ?? 'page',
      payload: (overrides.payload ?? PAGE_PAYLOAD) as never,
    })
    .returning();
  if (!t) throw new Error('template insert failed');
  return t.id;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'NO_ERROR';
  } catch (err) {
    if (err instanceof SlashCommandError) return err.code;
    throw err;
  }
}

describe('extractTemplateInsertContent', () => {
  it('returns the root page doc nodes for a page payload', () => {
    const content = extractTemplateInsertContent(PAGE_PAYLOAD);
    expect(content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Tpl body' }] }]);
  });

  it('returns null for database payloads, malformed payloads, and empty docs', () => {
    expect(extractTemplateInsertContent({ kind: 'database', pages: [], databases: [] })).toBeNull();
    expect(extractTemplateInsertContent({ nonsense: true })).toBeNull();
    expect(extractTemplateInsertContent(null)).toBeNull();
    expect(
      extractTemplateInsertContent({
        kind: 'page',
        pages: [{ id: 'p1', parentId: null, title: 'T', icon: null, content: { type: 'doc' } }],
        databases: [],
      }),
    ).toBeNull();
  });
});

describe('createSlashCommand / listSlashCommands / deleteSlashCommand', () => {
  it('creates, lists (template name joined), and deletes, auditing both ends', async () => {
    const w = await ws();
    const actor = await user();
    const tpl = await template(w, { name: 'Meeting notes' });

    const row = await createSlashCommand(db, {
      workspaceId: w,
      actorUserId: actor,
      trigger: 'meeting',
      label: 'Meeting notes',
      templateId: tpl,
    });
    expect(row.trigger).toBe('meeting');
    expect(row.enabled).toBe(true);
    expect(row.templateName).toBe('Meeting notes');

    const listed = await listSlashCommands(db, w);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.trigger).toBe('meeting');
    expect(listed[0]?.templateName).toBe('Meeting notes');

    await deleteSlashCommand(db, { workspaceId: w, actorUserId: actor, commandId: row.id });
    expect(await listSlashCommands(db, w)).toHaveLength(0);

    const audits = await db
      .select({ action: schema.auditLog.action, targetId: schema.auditLog.targetId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, w));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('workspace.slash_command_created');
    expect(actions).toContain('workspace.slash_command_deleted');
    for (const a of audits) expect(a.targetId).toBe(row.id);
  });

  it('normalizes the trigger (trim + lowercase) before validating', async () => {
    const w = await ws();
    const actor = await user();
    const tpl = await template(w);
    const row = await createSlashCommand(db, {
      workspaceId: w,
      actorUserId: actor,
      trigger: '  Meeting-Notes ',
      label: 'L',
      templateId: tpl,
    });
    expect(row.trigger).toBe('meeting-notes');
  });

  it('rejects malformed triggers (format)', async () => {
    const w = await ws();
    const actor = await user();
    const tpl = await template(w);
    const base = { workspaceId: w, actorUserId: actor, label: 'L', templateId: tpl };
    expect(await code(createSlashCommand(db, { ...base, trigger: 'x' }))).toBe('INVALID_TRIGGER');
    expect(await code(createSlashCommand(db, { ...base, trigger: 'has space' }))).toBe(
      'INVALID_TRIGGER',
    );
    expect(await code(createSlashCommand(db, { ...base, trigger: 'under_score' }))).toBe(
      'INVALID_TRIGGER',
    );
    expect(await code(createSlashCommand(db, { ...base, trigger: 'a'.repeat(33) }))).toBe(
      'INVALID_TRIGGER',
    );
  });

  it('rejects built-in collisions (todo / table / cite-doi)', async () => {
    const w = await ws();
    const actor = await user();
    const tpl = await template(w);
    const base = { workspaceId: w, actorUserId: actor, label: 'L', templateId: tpl };
    for (const trigger of ['todo', 'table', 'cite-doi']) {
      expect(await code(createSlashCommand(db, { ...base, trigger }))).toBe('BUILTIN_TRIGGER');
    }
  });

  it('rejects duplicate triggers per workspace but allows the same trigger in another workspace', async () => {
    const w1 = await ws('A');
    const w2 = await ws('B');
    const actor = await user();
    const tpl1 = await template(w1);
    const tpl2 = await template(w2);
    await createSlashCommand(db, {
      workspaceId: w1,
      actorUserId: actor,
      trigger: 'standup',
      label: 'L',
      templateId: tpl1,
    });
    expect(
      await code(
        createSlashCommand(db, {
          workspaceId: w1,
          actorUserId: actor,
          trigger: 'standup',
          label: 'L2',
          templateId: tpl1,
        }),
      ),
    ).toBe('DUPLICATE_TRIGGER');
    // Same trigger, different workspace: fine (UNIQUE is per workspace).
    const other = await createSlashCommand(db, {
      workspaceId: w2,
      actorUserId: actor,
      trigger: 'standup',
      label: 'L',
      templateId: tpl2,
    });
    expect(other.trigger).toBe('standup');
  });

  it('tenant guard: a foreign-workspace or global template is NOT FOUND', async () => {
    const w1 = await ws('A');
    const w2 = await ws('B');
    const actor = await user();
    const foreign = await template(w2);
    const global = await template(null); // built-in/global template
    const base = { workspaceId: w1, actorUserId: actor, trigger: 'standup', label: 'L' };
    expect(await code(createSlashCommand(db, { ...base, templateId: foreign }))).toBe(
      'TEMPLATE_NOT_FOUND',
    );
    expect(await code(createSlashCommand(db, { ...base, templateId: global }))).toBe(
      'TEMPLATE_NOT_FOUND',
    );
  });

  it('rejects database-kind and contentless templates as not insertable', async () => {
    const w = await ws();
    const actor = await user();
    const dbTpl = await template(w, {
      kind: 'database',
      payload: { kind: 'database', pages: [], databases: [] },
    });
    const emptyTpl = await template(w, {
      payload: {
        kind: 'page',
        rootPageId: 'p1',
        pages: [{ id: 'p1', parentId: null, title: 'T', icon: null, content: { type: 'doc' } }],
        databases: [],
      },
    });
    const base = { workspaceId: w, actorUserId: actor, trigger: 'standup', label: 'L' };
    expect(await code(createSlashCommand(db, { ...base, templateId: dbTpl }))).toBe(
      'TEMPLATE_NOT_INSERTABLE',
    );
    expect(await code(createSlashCommand(db, { ...base, templateId: emptyTpl }))).toBe(
      'TEMPLATE_NOT_INSERTABLE',
    );
  });

  it('delete: cross-workspace command id is NOT_FOUND (no leak)', async () => {
    const w1 = await ws('A');
    const w2 = await ws('B');
    const actor = await user();
    const tpl = await template(w1);
    const row = await createSlashCommand(db, {
      workspaceId: w1,
      actorUserId: actor,
      trigger: 'standup',
      label: 'L',
      templateId: tpl,
    });
    expect(
      await code(
        deleteSlashCommand(db, { workspaceId: w2, actorUserId: actor, commandId: row.id }),
      ),
    ).toBe('NOT_FOUND');
    // Still there for its own workspace.
    expect(await listSlashCommands(db, w1)).toHaveLength(1);
  });

  it('deleting the backing template cascades the command row away', async () => {
    const w = await ws();
    const actor = await user();
    const tpl = await template(w);
    const row = await createSlashCommand(db, {
      workspaceId: w,
      actorUserId: actor,
      trigger: 'doomed',
      label: 'L',
      templateId: tpl,
    });
    expect(await listSlashCommands(db, w)).toHaveLength(1);

    await db.delete(schema.templates).where(eq(schema.templates.id, tpl));

    const remaining = await db
      .select()
      .from(schema.workspaceSlashCommands)
      .where(eq(schema.workspaceSlashCommands.id, row.id));
    expect(remaining).toHaveLength(0);
    expect(await listSlashCommands(db, w)).toHaveLength(0);
  });
});
