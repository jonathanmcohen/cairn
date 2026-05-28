import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { canReadTemplate, listVisibleTemplates } from '@/lib/templates/access';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
beforeEach(async () => {
  await getDb().execute(
    sql`TRUNCATE templates, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`,
  );
});

async function seedTwoWorkspaces() {
  const u1 = await createTestWorkspaceWithUser(getDb());
  const u2 = await createTestWorkspaceWithUser(getDb());
  return { u1: u1.userId, u2: u2.userId, w1: u1.workspaceId, w2: u2.workspaceId };
}

async function insertTpl(
  workspaceId: string | null,
  visibility: schema.TemplateVisibility,
  name: string,
) {
  const [t] = await getDb()
    .insert(schema.templates)
    .values({
      workspaceId,
      name,
      kind: 'page',
      payload: {},
      visibility,
    })
    .returning();
  if (!t) throw new Error('insert template failed');
  return t;
}

describe('templates access — visibility matrix', () => {
  it('private template is visible only to members of the template workspace', async () => {
    const { u1, u2, w1 } = await seedTwoWorkspaces();
    const tpl = await insertTpl(w1, 'private', 'priv');
    expect(
      await canReadTemplate(getDb(), {
        templateId: tpl.id,
        viewerUserId: u1,
        viewerWorkspaceId: w1,
      }),
    ).toBe(true);
    expect(
      await canReadTemplate(getDb(), {
        templateId: tpl.id,
        viewerUserId: u2,
        viewerWorkspaceId: w1,
      }),
    ).toBe(false);
  });

  it('workspace template is visible to its workspace members and refused cross-workspace', async () => {
    const { u1, u2, w1, w2 } = await seedTwoWorkspaces();
    const tpl = await insertTpl(w1, 'workspace', 'ws');
    expect(
      await canReadTemplate(getDb(), {
        templateId: tpl.id,
        viewerUserId: u1,
        viewerWorkspaceId: w1,
      }),
    ).toBe(true);
    expect(
      await canReadTemplate(getDb(), {
        templateId: tpl.id,
        viewerUserId: u2,
        viewerWorkspaceId: w2,
      }),
    ).toBe(false);
  });

  it('public template is visible to any signed-in viewer regardless of workspace', async () => {
    const { u2, w1, w2 } = await seedTwoWorkspaces();
    const tpl = await insertTpl(w1, 'public', 'pub');
    expect(
      await canReadTemplate(getDb(), {
        templateId: tpl.id,
        viewerUserId: u2,
        viewerWorkspaceId: w2,
      }),
    ).toBe(true);
  });

  it('returns false for a missing template id', async () => {
    const { u1, w1 } = await seedTwoWorkspaces();
    const fakeId = '00000000-0000-0000-0000-000000000000';
    expect(
      await canReadTemplate(getDb(), {
        templateId: fakeId,
        viewerUserId: u1,
        viewerWorkspaceId: w1,
      }),
    ).toBe(false);
  });

  it('listVisibleTemplates returns visible rows + filters out hidden ones', async () => {
    const { u1, u2, w1, w2 } = await seedTwoWorkspaces();
    const tA = await insertTpl(w1, 'private', 'privA');
    const tB = await insertTpl(w1, 'workspace', 'wsA');
    const tC = await insertTpl(w1, 'public', 'pubA');
    const tD = await insertTpl(w2, 'workspace', 'wsB');

    const forU1 = await listVisibleTemplates(getDb(), {
      viewerUserId: u1,
      viewerWorkspaceId: w1,
    });
    expect(forU1.map((r) => r.id).sort()).toEqual([tA.id, tB.id, tC.id].sort());

    const forU2 = await listVisibleTemplates(getDb(), {
      viewerUserId: u2,
      viewerWorkspaceId: w2,
    });
    // u2 sees w2's workspace + the public; not w1's private/workspace.
    expect(forU2.map((r) => r.id).sort()).toEqual([tC.id, tD.id].sort());
  });

  it('listVisibleTemplates surfaces built-in (workspaceId=null) public rows', async () => {
    const { u1, w1 } = await seedTwoWorkspaces();
    const builtin = await insertTpl(null, 'public', 'builtin');
    const rows = await listVisibleTemplates(getDb(), {
      viewerUserId: u1,
      viewerWorkspaceId: w1,
    });
    expect(rows.map((r) => r.id)).toContain(builtin.id);
  });
});
