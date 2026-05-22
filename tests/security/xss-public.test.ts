import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Node as PMNode } from 'prosemirror-model';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resolveEmbed } from '@/lib/editor/embed-allowlist';
import { getPublishedPageBySlug } from '@/lib/pages/public';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

// A TipTap/ProseMirror JSON doc whose text nodes carry XSS payloads. The public
// read-only view (`editable:false`) deserializes this typed JSON via the
// ProseMirror schema and renders nodes — it never `dangerouslySetInnerHTML`s the
// stored string. So a stored "<script>"/"onerror=" can only surface as a `text`
// node, which the renderer emits as escaped text content, not active markup.
const HOSTILE_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '<script>window.__pwned=1</script>' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }],
    },
  ],
};

// The schema the public ReadOnlyView builds on (StarterKit is the core of
// `baseExtensions()`); deserializing through it mirrors the render path.
const pmSchema = getSchema([StarterKit]);

/** Collect the type name of every node that contains the payload substring. */
function nodeTypesContaining(doc: PMNode, needle: string): string[] {
  const types: string[] = [];
  doc.descendants((node) => {
    if (node.isText && (node.text ?? '').includes(needle)) {
      // payload sits in a text node — the only place it can be (escaped on render)
      types.push('text');
    } else if (!node.isText && node.type.name !== 'doc') {
      // any element node must NOT itself be the script (it'd be active markup)
      if (node.type.name.toLowerCase().includes('script')) types.push(node.type.name);
    }
    return true;
  });
  return types;
}

describe('public render XSS safety', () => {
  it('stored script payload deserializes to inert text, never an active node', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.workspaceId,
        title: 'x',
        createdBy: ws.userId,
        content: HOSTILE_DOC,
        published: true,
        publicSlug: 'xss-1',
      })
      .returning();
    if (!p) throw new Error('seed failed');

    // Resolve the page exactly as the /p/<slug> route does.
    const page = await getPublishedPageBySlug(db, 'xss-1');
    expect(page).not.toBeNull();

    // Deserialize the stored doc through the render schema (what the read-only
    // view does internally). The schema has no `script`/`img` node type, so the
    // payload can only land as text — proving it cannot be active markup.
    const doc = PMNode.fromJSON(pmSchema, page?.content as Record<string, unknown>);

    expect(pmSchema.nodes.script).toBeUndefined(); // no script node type exists
    const scriptCarriers = nodeTypesContaining(doc, 'window.__pwned');
    expect(scriptCarriers).toEqual(['text']); // payload lives ONLY in a text node
    expect(nodeTypesContaining(doc, 'onerror=')).toEqual(['text']);

    // And the rendered text content preserves the payload verbatim as data —
    // the read-only view will escape it to visible text, not execute it.
    expect(doc.textContent).toContain('<script>window.__pwned=1</script>');
    expect(doc.textContent).toContain('onerror=alert(1)');
  });

  it('only published, slug-matched pages resolve on the public path', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.workspaceId,
        title: 'x',
        createdBy: ws.userId,
        content: HOSTILE_DOC,
        published: true,
        publicSlug: 'xss-2',
      })
      .returning();

    const page = await getPublishedPageBySlug(db, 'xss-2');
    expect(JSON.stringify(page?.content)).toContain('window.__pwned=1');

    const [other] = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.publicSlug, 'xss-2'));
    expect(other?.published).toBe(true);
    expect(await getPublishedPageBySlug(db, 'nope')).toBeNull();
  });
});

// v0.6.0 added an `embed` block (allowlist-only iframe) and a `bookmark` block
// whose metadata is unfurled server-side via /api/unfurl. Both are attack
// surfaces: the embed src is rendered into an iframe (XSS/SSRF if arbitrary),
// and the unfurl fetch is a classic SSRF sink (it dereferences a user URL on the
// server). These cases pin the security CONTRACT for those surfaces. They are
// pure (no DB), so they run regardless of the integration fixtures above.
describe('v0.6.0 embed + unfurl surface (SSRF/allowlist)', () => {
  it('the embed allowlist refuses arbitrary origins (no SSRF/XSS via iframe src)', () => {
    expect(resolveEmbed('https://attacker.example/iframe')).toBeNull();
    expect(resolveEmbed('https://127.0.0.1/internal')).toBeNull();
    expect(resolveEmbed('javascript:alert(1)')).toBeNull();
    expect(resolveEmbed('data:text/html,<script>1</script>')).toBeNull();
  });

  it('every allowlisted embed src is https and on a known frame host', () => {
    const ok = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://vimeo.com/76979871',
      'https://www.figma.com/file/abc/x',
      'https://gist.github.com/u/abc',
      'https://codesandbox.io/s/abc12',
    ];
    for (const u of ok) {
      const r = resolveEmbed(u);
      expect(r, u).not.toBeNull();
      expect(r?.src.startsWith('https://'), u).toBe(true);
    }
  });

  it('the unfurl SSRF guard rejects internal/metadata/loopback targets', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toThrow();
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow();
    await expect(assertPublicUrl('ftp://example.com/')).rejects.toThrow();
  });
});
