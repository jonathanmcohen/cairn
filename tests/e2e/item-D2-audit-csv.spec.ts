// v0.10.0 D2 — Audit log CSV export (/settings/admin/audit Export button →
// GET /api/admin/audit/export).
//
// Generating 100+ real audited actions through the UI would be slow, so the
// specs seed audit_log rows DIRECTLY via the harness DB connection
// (postgres-js, same pattern as the D1 SIEM spec). Every seeded row carries a
// unique stamp in target_type and metadata so the persistent e2e dev DB never
// bleeds state between runs; cleanup happens in a finally.
//
// Coverage:
//  - pagination-cap trap: viewer pages at 100, export streams ALL 120 rows
//  - RFC-4180: metadata with comma+quote+newline still parses to 120 rows
//  - formula-injection guard: a page titled `=cmd|' /C calc'!A0` exports with
//    a leading apostrophe (byte-level assert on the raw body)
//  - tenant isolation: a row seeded for a DIFFERENT workspace never appears
//  - editor role → 403
//  - UI: clicking the Export button fires a browser download with the
//    cairn-audit-<date>.csv filename
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

const INJECTION_TITLE = `=cmd|' /C calc'!A0`;

function stamp(): string {
  return `d2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Tiny RFC-4180 parser (quoted fields, doubled quotes, CRLF records). */
function parseCsv(raw: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (raw.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && raw.charAt(i + 1) === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 2;
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

// Column indexes (kept in sync with AUDIT_CSV_COLUMNS; the header assert below
// fails loudly if the route's column order ever drifts).
const EXPECTED_HEADER = [
  'id',
  'workspaceId',
  'createdAt',
  'action',
  'actorUserId',
  'actorName',
  'targetType',
  'targetId',
  'targetTitle',
  'targetHref',
  'ip',
  'metadata',
];
const COL_WORKSPACE = 1;
const COL_TARGET_ID = 7;
const COL_TARGET_TITLE = 8;
const COL_METADATA = 11;

test.describe('item D2 — audit log CSV export', () => {
  test('streams ALL matching rows past the 100-row viewer cap, RFC-4180 intact, tenant-isolated', async ({
    page,
    seeded,
  }) => {
    const mark = stamp();
    const nastyNote = 'comma, "quoted"\nnewline';
    let foreignWsId: string | null = null;
    try {
      await withSql(async (sql) => {
        // 119 plain rows + 1 row whose metadata carries comma+quote+newline =
        // 120 stamped rows for the primary workspace (filterable via the
        // free-form targetType param, which the list/export Zod schema allows).
        await sql`
          insert into audit_log (workspace_id, action, target_type, metadata)
          select ${seeded.workspaceId}::uuid, 'workspace.settings_changed', ${mark}::text,
                 jsonb_build_object('stamp', ${mark}::text, 'seq', g)
          from generate_series(1, 119) g
        `;
        await sql`
          insert into audit_log (workspace_id, action, target_type, metadata)
          values (${seeded.workspaceId}::uuid, 'workspace.settings_changed', ${mark},
                  ${JSON.stringify({ stamp: mark, note: nastyNote })}::jsonb)
        `;
        // One row in a DIFFERENT workspace with the SAME stamp — must never
        // leak into the primary workspace's export.
        const [ws] = await sql`
          insert into workspaces (name, slug)
          values (${`D2 Foreign ${mark}`}, ${`d2-foreign-${mark}`})
          returning id
        `;
        foreignWsId = (ws as { id: string }).id;
        await sql`
          insert into audit_log (workspace_id, action, target_type, metadata)
          values (${foreignWsId}::uuid, 'workspace.settings_changed', ${mark},
                  ${JSON.stringify({ stamp: mark, marker: `foreign-${mark}` })}::jsonb)
        `;
      });

      await signIn(page, seeded);
      const res = await page.request.get(`/api/admin/audit/export?targetType=${mark}`);
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      expect(res.headers()['content-type']).toContain('text/csv');
      expect(res.headers()['content-disposition']).toMatch(
        /^attachment; filename="cairn-audit-\d{4}-\d{2}-\d{2}\.csv"$/,
      );

      const raw = await res.text();
      const records = parseCsv(raw);
      expect(records[0]).toEqual(EXPECTED_HEADER);

      // Pagination-cap trap: the viewer pages at 100 rows; the export must
      // stream every matching row in one response.
      const dataRows = records.slice(1);
      expect(dataRows).toHaveLength(120);

      // RFC-4180 raw bytes: the nasty metadata cell is quoted with internal
      // quotes doubled. The cell holds JSON, so the note's quote arrives as
      // `\"` and CSV doubling turns it into `\""` — assert that exact shape.
      expect(raw).toContain('\\""quoted\\""');
      const nasty = dataRows.find((r) => (r[COL_METADATA] ?? '').includes('newline'));
      expect(nasty).toBeDefined();
      const meta = JSON.parse((nasty as string[])[COL_METADATA] as string) as { note: string };
      expect(meta.note).toBe(nastyNote);

      // Tenant isolation: every exported row belongs to the caller's
      // workspace and the foreign marker never appears.
      for (const row of dataRows) {
        expect(row[COL_WORKSPACE]).toBe(seeded.workspaceId);
      }
      expect(raw).not.toContain(`foreign-${mark}`);
    } finally {
      await withSql(async (sql) => {
        await sql`delete from audit_log where target_type = ${mark}`;
        if (foreignWsId) await sql`delete from workspaces where id = ${foreignWsId}::uuid`;
      });
    }
  });

  test('formula-injection guard: hostile targetTitle exports with a leading apostrophe', async ({
    page,
    seeded,
  }) => {
    const mark = stamp();
    let pageId: string | null = null;
    try {
      await withSql(async (sql) => {
        const db = drizzle(sql, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
        const [user] = await sql`select id from users where email = ${seeded.userEmail}`;
        if (!user) throw new Error('seeded user not found');
        // A REAL page with the hostile title — the export's enrichment step
        // resolves targetTitle from the pages table, which is exactly the
        // cell a spreadsheet would execute without the guard.
        const created = await createPage(db, {
          workspaceId: seeded.workspaceId,
          createdBy: (user as { id: string }).id,
          title: INJECTION_TITLE,
        });
        pageId = created.id;
        await sql`
          insert into audit_log (workspace_id, action, target_type, target_id, metadata)
          values (${seeded.workspaceId}::uuid, 'page.published', 'page', ${pageId}::uuid,
                  ${JSON.stringify({ stamp: mark })}::jsonb)
        `;
      });

      await signIn(page, seeded);
      const res = await page.request.get(`/api/admin/audit/export?targetId=${pageId}`);
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      const raw = await res.text();

      // Byte-level: the targetTitle cell starts with the literal apostrophe
      // guard, surrounded by its neighbor commas (the title itself contains
      // no comma/double-quote, so the cell stays unquoted).
      expect(raw).toContain(`,'${INJECTION_TITLE},`);
      const rows = parseCsv(raw).slice(1);
      const row = rows.find((r) => r[COL_TARGET_ID] === pageId);
      expect(row).toBeDefined();
      expect((row as string[])[COL_TARGET_TITLE]).toBe(`'${INJECTION_TITLE}`);
    } finally {
      await withSql(async (sql) => {
        if (pageId) {
          await sql`delete from audit_log where target_id = ${pageId}::uuid`;
          await sql`delete from pages where id = ${pageId}::uuid`;
        }
      });
    }
  });

  test('editor role: direct GET to the export route answers 403', async ({
    browser,
    page,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    await signIn(page, seeded);
    // seedSecondUser defaults to role 'editor' — below the admin gate.
    const second = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
    const { context, page: editorPage } = await signInSecondUser(browser, second);
    try {
      const res = await editorPage.request.get('/api/admin/audit/export');
      expect(res.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test('UI: Export button triggers a browser download with the dated filename', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/audit');
    const link = page.getByTestId('audit-export-csv');
    await expect(link).toBeVisible({ timeout: 15_000 });
    // No filters active → the href is the bare export route (the same
    // buildQuery used for fetches appends the active filters when set).
    await expect(link).toHaveAttribute('href', '/api/admin/audit/export');

    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^cairn-audit-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
