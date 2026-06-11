// v0.10.0 Plan F F2 — custom slash commands → templates.
//
// A workspace admin binds a /trigger word to a saved page template
// (workspace_slash_commands, migration 0075). The editor's slash menu grows a
// "Workspace" group: picking the command inserts the template's root-page
// content AT THE CURSOR through editor.chain().insertContent(...) — the
// normal transaction pipeline, so it replicates over the live Yjs collab
// server like hand-typed content (never a doc swap).
//
// RED on the old build:
//  - (a) POST /api/workspaces/:id/slash-commands 404s (route doesn't exist),
//    and the slash menu has no Workspace group — the falsifiable-core
//    assertion (template sentinel inserted at the cursor) can never pass;
//  - (b) the peer can't see content no command could insert;
//  - (c) nothing rejects built-in collisions;
//  - (d/e/f) the listed guards don't exist.
//
// Determinism notes (persistent e2e dev DB): every row this spec creates is
// stamped and deleted in finally (commands, templates, source + editor pages,
// the foreign workspace, audit rows by target id). The editor menu is primed
// once per editor MOUNT (documented staleness), so commands are always
// created BEFORE the page under test is opened, and (d) re-opens the page
// after the template deletion.
import postgres from 'postgres';
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

type PwPage = import('@playwright/test').Page;

function stamp(): string {
  return `f2${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Track every created row id; finally tears all of them down in FK order. */
type Created = { pageIds: string[]; templateIds: string[]; commandIds: string[] };

function tracker(): Created {
  return { pageIds: [], templateIds: [], commandIds: [] };
}

async function cleanup(created: Created): Promise<void> {
  await withSql(async (sql) => {
    const targets = [...created.pageIds, ...created.templateIds, ...created.commandIds];
    for (const id of targets) {
      await sql`delete from audit_log where target_id = ${id}::uuid`;
    }
    for (const id of created.commandIds) {
      await sql`delete from workspace_slash_commands where id = ${id}::uuid`;
    }
    for (const id of created.templateIds) {
      await sql`delete from templates where id = ${id}::uuid`;
    }
    for (const id of created.pageIds) {
      await sql`delete from pages where id = ${id}::uuid`;
    }
  });
}

/** Save a freshly-created page (carrying `sentinel`) as a workspace template
 *  through the real save-as-template route (v0.9.0 P25). */
async function createTemplateViaApi(
  page: PwPage,
  created: Created,
  args: { name: string; sentinel: string },
): Promise<string> {
  const srcPageId = await createPageViaApi(
    page,
    `${args.name} source`,
    pmDoc(pmParagraph(args.sentinel)),
  );
  created.pageIds.push(srcPageId);
  const res = await page.request.post('/api/templates', {
    data: { kind: 'page', name: args.name, pageId: srcPageId },
  });
  expect(res.status(), await res.text().catch(() => '')).toBe(201);
  const { template } = (await res.json()) as { template: { id: string } };
  created.templateIds.push(template.id);
  return template.id;
}

async function createCommandViaApi(
  page: PwPage,
  created: Created,
  args: { workspaceId: string; trigger: string; label: string; templateId: string },
): Promise<string> {
  const res = await page.request.post(`/api/workspaces/${args.workspaceId}/slash-commands`, {
    data: { trigger: args.trigger, label: args.label, templateId: args.templateId },
  });
  expect(res.status(), await res.text().catch(() => '')).toBe(201);
  const { command } = (await res.json()) as { command: { id: string } };
  created.commandIds.push(command.id);
  return command.id;
}

const SLASH_LISTBOX = '[role="listbox"][aria-label="Slash commands"]';

test.describe('item F2 — custom slash commands insert saved templates', () => {
  test('(a) falsifiable core: /trigger shows the Workspace command and Enter inserts the template at the cursor', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const created = tracker();
    try {
      const s = stamp();
      const sentinel = `F2 template sentinel ${s}`;
      const trigger = `${s}-tpl`;
      const label = `F2 meeting notes ${s}`;
      const templateId = await createTemplateViaApi(page, created, {
        name: `F2 template ${s}`,
        sentinel,
      });
      await createCommandViaApi(page, created, {
        workspaceId: seeded.workspaceId,
        trigger,
        label,
        templateId,
      });

      // Open the page AFTER the command exists (menu primes on editor mount).
      const anchor = `F2 editor anchor ${s}`;
      const pageId = await createPageViaApi(page, `F2 core ${s}`, pmDoc(pmParagraph(anchor)));
      created.pageIds.push(pageId);
      const editor = await openPageEditor(page, pageId, anchor);

      await typeSlashQueryAtDocEnd(page, editor, `/${trigger}`);

      // THE RED ASSERTION on the old build: no Workspace group, no command.
      const listbox = page.locator(SLASH_LISTBOX);
      await expect(listbox).toBeVisible({ timeout: 10_000 });
      await expect(listbox.getByText('Workspace', { exact: true })).toBeVisible();
      const option = listbox.locator('[role="option"]', { hasText: label });
      await expect(option).toBeVisible();

      await page.keyboard.press('Enter');

      // Template content lands at the cursor through the insert pipeline…
      await expect(editor).toContainText(sentinel, { timeout: 15_000 });
      // …the /trigger text is consumed, and the pre-trigger body text stays.
      await expect(editor.locator('p', { hasText: `/${trigger}` })).toHaveCount(0);
      await expect(editor).toContainText(anchor);
    } finally {
      await cleanup(created);
    }
  });

  test('(b) Yjs replication: a second client sees the inserted template content live', async ({
    page,
    seeded,
    browser,
  }) => {
    await signIn(page, seeded);
    const created = tracker();
    // Same user in a second tab/context (two distinct collab clients over ws —
    // the item-E4 test (c) pattern).
    const contextB = await browser.newContext();
    try {
      const s = stamp();
      const sentinel = `F2 collab sentinel ${s}`;
      const trigger = `${s}-collab`;
      const templateId = await createTemplateViaApi(page, created, {
        name: `F2 collab template ${s}`,
        sentinel,
      });
      await createCommandViaApi(page, created, {
        workspaceId: seeded.workspaceId,
        trigger,
        label: `F2 collab ${s}`,
        templateId,
      });

      const anchor = `F2 collab anchor ${s}`;
      const pageId = await createPageViaApi(page, `F2 collab ${s}`, pmDoc(pmParagraph(anchor)));
      created.pageIds.push(pageId);
      const editorA = await openPageEditor(page, pageId, anchor);

      const pageB = await contextB.newPage();
      await signIn(pageB, seeded);
      const editorB = await openPageEditor(pageB, pageId, anchor);

      // Client A fires the command…
      await typeSlashQueryAtDocEnd(page, editorA, `/${trigger}`);
      await expect(page.locator(SLASH_LISTBOX)).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Enter');
      await expect(editorA).toContainText(sentinel, { timeout: 15_000 });

      // …and client B receives the inserted content over Yjs. If the insert
      // bypassed the editor pipeline (doc swap), B would never converge.
      await expect(editorB).toContainText(sentinel, { timeout: 20_000 });
    } finally {
      await contextB.close();
      await cleanup(created);
    }
  });

  test('(c) builtin collision: POST trigger "todo" -> 400 BUILTIN_TRIGGER and the list is unchanged', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const created = tracker();
    try {
      const s = stamp();
      // 'todo' IS a built-in trigger: it is a keyword of the "Checkbox list"
      // slash item (slash-extension.ts) and pinned in BUILTIN_SLASH_TRIGGERS.
      const templateId = await createTemplateViaApi(page, created, {
        name: `F2 builtin template ${s}`,
        sentinel: `F2 builtin sentinel ${s}`,
      });
      const res = await page.request.post(`/api/workspaces/${seeded.workspaceId}/slash-commands`, {
        data: { trigger: 'todo', label: `F2 builtin ${s}`, templateId },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { code?: string; error?: string };
      expect(body.code).toBe('BUILTIN_TRIGGER');
      expect(body.error).toBeTruthy();

      // The menu source is unchanged: no command row was created.
      const list = await page.request.get(`/api/workspaces/${seeded.workspaceId}/slash-commands`);
      expect(list.status()).toBe(200);
      const { commands } = (await list.json()) as { commands: { trigger: string }[] };
      expect(commands.map((c) => c.trigger)).not.toContain('todo');
    } finally {
      await cleanup(created);
    }
  });

  test('(d) template deletion cascades: the command disappears from the menu', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const created = tracker();
    try {
      const s = stamp();
      const trigger = `${s}-gone`;
      const label = `F2 doomed ${s}`;
      const templateId = await createTemplateViaApi(page, created, {
        name: `F2 doomed template ${s}`,
        sentinel: `F2 doomed sentinel ${s}`,
      });
      const commandId = await createCommandViaApi(page, created, {
        workspaceId: seeded.workspaceId,
        trigger,
        label,
        templateId,
      });

      const anchor = `F2 doomed anchor ${s}`;
      const pageId = await createPageViaApi(page, `F2 doomed ${s}`, pmDoc(pmParagraph(anchor)));
      created.pageIds.push(pageId);
      let editor = await openPageEditor(page, pageId, anchor);

      // Present BEFORE deletion (sanity, so the post-delete absence means
      // something). Escape closes the menu without selecting.
      await typeSlashQueryAtDocEnd(page, editor, `/${trigger}`);
      const listbox = page.locator(SLASH_LISTBOX);
      await expect(listbox.locator('[role="option"]', { hasText: label })).toBeVisible({
        timeout: 10_000,
      });
      await page.keyboard.press('Escape');

      // Delete the TEMPLATE (real route) → ON DELETE CASCADE removes the
      // command row (plan-pinned: cascade = gone, no broken-flag state).
      const del = await page.request.delete(`/api/templates/${templateId}`);
      // The templates DELETE answers 200-with-body or 204 depending on state —
      // both are success; the contract under test is the CASCADE below.
      expect([200, 204], await del.text().catch(() => '')).toContain(del.status());
      const rows = await withSql(
        (sql) => sql`select id from workspace_slash_commands where id = ${commandId}::uuid`,
      );
      expect(rows.length).toBe(0);

      // Reload (fresh editor mount re-primes the menu) → the command is gone.
      editor = await openPageEditor(page, pageId, anchor);
      await typeSlashQueryAtDocEnd(page, editor, `/${trigger}`);
      await expect(page.locator('.tippy-box.cairn-slash-popup')).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator(SLASH_LISTBOX).locator('[role="option"]', { hasText: label }),
      ).toHaveCount(0);
      // Nothing else matches the stamped trigger either — the popup shows the
      // empty state rather than the deleted command.
      await expect(page.locator('.tippy-box.cairn-slash-popup')).toContainText('No results');
    } finally {
      await cleanup(created);
    }
  });

  test('(e) mid-word guard: typing word/<trigger> without a space does not open the menu', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const created = tracker();
    try {
      const s = stamp();
      const trigger = `${s}-mid`;
      const templateId = await createTemplateViaApi(page, created, {
        name: `F2 midword template ${s}`,
        sentinel: `F2 midword sentinel ${s}`,
      });
      await createCommandViaApi(page, created, {
        workspaceId: seeded.workspaceId,
        trigger,
        label: `F2 midword ${s}`,
        templateId,
      });

      const anchor = `F2 midword anchor ${s}`;
      const pageId = await createPageViaApi(page, `F2 midword ${s}`, pmDoc(pmParagraph(anchor)));
      created.pageIds.push(pageId);
      const editor = await openPageEditor(page, pageId, anchor);

      // typeSlashQueryAtDocEnd opens a FRESH paragraph; typing "word" first
      // puts a word character before the '/', so allowedPrefixes [' '] must
      // reject the trigger — even for a real, registered workspace command.
      await typeSlashQueryAtDocEnd(page, editor, `word/${trigger}`);
      await expect(editor).toContainText(`word/${trigger}`, { timeout: 10_000 });
      await expect(page.locator('.tippy-box.cairn-slash-popup[data-state="visible"]')).toHaveCount(
        0,
      );
      await expect(page.locator(SLASH_LISTBOX)).toHaveCount(0);
    } finally {
      await cleanup(created);
    }
  });

  test('(f) tenant isolation: a foreign workspace 404s and its commands never reach this workspace list', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const created = tracker();
    const s = stamp();
    let foreignWsId: string | null = null;
    try {
      const foreignTrigger = `${s}-foreign`;
      // Workspace B + a template + a command in it, seeded directly (the D5
      // foreign-workspace withSql pattern). The seeded user is NOT a member.
      foreignWsId = await withSql(async (sql) => {
        const [ws] = await sql`
          insert into workspaces (name, slug)
          values (${`F2 Foreign ${s}`}, ${`f2-foreign-${s}`})
          returning id
        `;
        const wsId = (ws as { id: string }).id;
        const payload = {
          kind: 'page',
          rootPageId: 'p1',
          pages: [
            {
              id: 'p1',
              parentId: null,
              title: 'Foreign',
              icon: null,
              content: pmDoc(pmParagraph(`F2 foreign sentinel ${s}`)),
            },
          ],
          databases: [],
        };
        const [tpl] = await sql`
          insert into templates (workspace_id, name, kind, payload)
          values (${wsId}::uuid, ${`F2 foreign template ${s}`}, 'page',
                  ${JSON.stringify(payload)}::jsonb)
          returning id
        `;
        await sql`
          insert into workspace_slash_commands (workspace_id, trigger, template_id, label)
          values (${wsId}::uuid, ${foreignTrigger},
                  ${(tpl as { id: string }).id}::uuid, ${`F2 foreign ${s}`})
        `;
        return wsId;
      });

      // The lighter isolation pin (plan-accepted alternative to an in-session
      // workspace switch): the URL id must be the caller's ACTIVE workspace —
      // workspace B 404s for the seeded user (existence-hiding), for both the
      // list the editor fetches and the admin mutations.
      const getB = await page.request.get(`/api/workspaces/${foreignWsId}/slash-commands`);
      expect(getB.status()).toBe(404);
      const postB = await page.request.post(`/api/workspaces/${foreignWsId}/slash-commands`, {
        data: { trigger: `${s}-x`, label: 'x', templateId: crypto.randomUUID() },
      });
      expect(postB.status()).toBe(404);

      // And workspace A's list never leaks B's command. The editor fetch is
      // workspace-scoped BY CONSTRUCTION: editor.tsx primes
      // /api/workspaces/<its own workspaceId prop>/slash-commands and the
      // slash items() reads the cache under that same id — so this API-level
      // pin covers the menu too.
      const getA = await page.request.get(`/api/workspaces/${seeded.workspaceId}/slash-commands`);
      expect(getA.status()).toBe(200);
      const { commands } = (await getA.json()) as { commands: { trigger: string }[] };
      expect(commands.map((c) => c.trigger)).not.toContain(foreignTrigger);
    } finally {
      await withSql(async (sql) => {
        if (foreignWsId) {
          // Cascades templates + workspace_slash_commands in workspace B.
          await sql`delete from workspaces where id = ${foreignWsId}::uuid`;
        }
      });
      await cleanup(created);
    }
  });
});
