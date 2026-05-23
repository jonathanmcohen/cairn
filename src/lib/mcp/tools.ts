import { type ZodTypeAny, z } from 'zod';
import type { TokenContext } from '@/lib/auth/token';

/**
 * The closed scope vocab — copied from the v0.7.0 spec (Section 3 G1). Kept as a
 * local literal-union so this module has no circular dep on the auth layer.
 */
export type Scope =
  | 'pages:read'
  | 'pages:write'
  | 'pages:destructive'
  | 'databases:read'
  | 'databases:write'
  | 'databases:destructive'
  | 'comments:read'
  | 'comments:write'
  | 'comments:destructive'
  | 'files:read'
  | 'files:write'
  | 'files:destructive'
  | 'mcp:read'
  | 'mcp:write'
  | 'mcp:destructive'
  | 'admin';

/**
 * A tool descriptor — the unit the MCP dispatcher operates on. Every handler
 * calls a v0.5 / v0.6 library helper; this module does NOT re-implement any
 * page / db / file business logic. The library helpers themselves enforce
 * workspace scoping (and, once integrated, `requirePageAcl(pageId, minPermission)`);
 * the dispatcher does NOT re-do that check.
 */
export type ToolDescriptor = {
  /** Stable tool id (closed enum — see the v0.7.0 spec Section 3 G2). */
  id: string;
  /** Description shown to the LLM via tools/list. */
  description: string;
  /** Required scope on the calling PAT. */
  scope: Scope;
  /** True if the action is non-recoverable (delete / destructive update). */
  destructive: boolean;
  /** Zod schema for the tool args (parsed before the handler runs). */
  inputSchema: ZodTypeAny;
  /** The actual work. Throws McpError for layered failures; returns serializable output otherwise. */
  handler: (ctx: TokenContext, args: unknown) => Promise<unknown>;
};

// ── Shared arg schemas ──────────────────────────────────────────────────────

const PageIdArg = z.object({ pageId: z.uuid() });
const DatabaseIdArg = z.object({ databaseId: z.uuid() });
const RowRefArg = z.object({ databaseId: z.uuid(), rowId: z.uuid() });
const ListPagesArg = z.object({
  parentId: z.uuid().nullable().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const CreatePageArg = z.object({
  title: z.string().min(1).max(500),
  parentId: z.uuid().nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
});
const UpdatePageArg = PageIdArg.extend({
  title: z.string().min(1).max(500).optional(),
  icon: z.string().max(64).nullable().optional(),
  content: z.unknown().optional(),
});
const MovePageArg = PageIdArg.extend({ newParentId: z.uuid().nullable() });
const CreateRowArg = DatabaseIdArg.extend({
  cells: z.record(z.string(), z.unknown()),
});
const UpdateRowCellsArg = RowRefArg.extend({
  cells: z.record(z.string(), z.unknown()),
});
const ListRowsArg = DatabaseIdArg.extend({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
const SearchFtsArg = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(20),
});
const ListCommentsArg = PageIdArg;
const CreateCommentArg = PageIdArg.extend({ body: z.string().min(1).max(10_000) });
const ListFilesArg = z.object({
  pageId: z.uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const FileIdArg = z.object({ fileId: z.uuid() });
const Empty = z.object({});

/**
 * The hardcoded initial tool set — 19 tools. `search.semantic` is added in P13.
 *
 * Every handler imports its underlying lib helper dynamically — this keeps the
 * module-level import graph thin and lets the dispatcher / tests stub handlers
 * by mutating `toolMap` entries without re-resolving import side-effects.
 */
export const registry: ToolDescriptor[] = [
  // ── pages ─────────────────────────────────────────────────────────────
  {
    id: 'pages.list',
    description: 'List pages in the workspace (optionally scoped to a parent).',
    scope: 'pages:read',
    destructive: false,
    inputSchema: ListPagesArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { getPageTree } = await import('@/lib/pages/tree');
      const parsed = ListPagesArg.parse(args);
      const tree = await getPageTree(getDb(), ctx.workspaceId);
      // The tree helper already filters workspace-scope + non-deleted. Flatten
      // and (optionally) constrain to direct children of `parentId`.
      const flat: { id: string; parentId: string | null; title: string; icon: string | null }[] =
        [];
      const walk = (
        nodes: {
          id: string;
          parentId: string | null;
          title: string;
          icon: string | null;
          children: typeof nodes;
        }[],
      ): void => {
        for (const n of nodes) {
          flat.push({ id: n.id, parentId: n.parentId, title: n.title, icon: n.icon });
          walk(n.children);
        }
      };
      walk(tree);
      const filtered =
        parsed.parentId === undefined
          ? flat
          : flat.filter((p) => p.parentId === (parsed.parentId ?? null));
      return { items: filtered.slice(0, parsed.limit) };
    },
  },
  {
    id: 'pages.read',
    description: 'Read a single page (metadata + content JSON).',
    scope: 'pages:read',
    destructive: false,
    inputSchema: PageIdArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { getPage } = await import('@/lib/pages/get');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = PageIdArg.parse(args);
      const page = await getPage(getDb(), { pageId: parsed.pageId, workspaceId: ctx.workspaceId });
      if (!page) throw new HttpError(404, 'Page not found');
      return page;
    },
  },
  {
    id: 'pages.create',
    description: 'Create a new page (optionally as a child of another page).',
    scope: 'pages:write',
    destructive: false,
    inputSchema: CreatePageArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { createPage } = await import('@/lib/pages/create');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = CreatePageArg.parse(args);
      if (!ctx.userId) throw new HttpError(403, 'Token missing user identity');
      return createPage(getDb(), {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        title: parsed.title,
        ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
        ...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
      });
    },
  },
  {
    id: 'pages.update',
    description: 'Update a page (title, icon, and/or content).',
    scope: 'pages:write',
    destructive: false,
    inputSchema: UpdatePageArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { updatePage } = await import('@/lib/pages/update');
      const parsed = UpdatePageArg.parse(args);
      const patch: { title?: string; icon?: string | null; content?: unknown } = {};
      if (parsed.title !== undefined) patch.title = parsed.title;
      if (parsed.icon !== undefined) patch.icon = parsed.icon;
      if (parsed.content !== undefined) patch.content = parsed.content;
      return updatePage(getDb(), {
        pageId: parsed.pageId,
        workspaceId: ctx.workspaceId,
        patch,
      });
    },
  },
  {
    id: 'pages.delete',
    description: 'Soft-delete a page (move to trash).',
    scope: 'pages:destructive',
    destructive: true,
    inputSchema: PageIdArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { softDeletePage } = await import('@/lib/pages/delete');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = PageIdArg.parse(args);
      if (!ctx.userId) throw new HttpError(403, 'Token missing user identity');
      await softDeletePage(getDb(), {
        pageId: parsed.pageId,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
      });
      return { ok: true };
    },
  },
  {
    id: 'pages.move',
    description: 'Reparent a page within the workspace tree.',
    scope: 'pages:write',
    destructive: false,
    inputSchema: MovePageArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { movePage } = await import('@/lib/pages/move');
      const parsed = MovePageArg.parse(args);
      await movePage(getDb(), {
        pageId: parsed.pageId,
        workspaceId: ctx.workspaceId,
        newParentId: parsed.newParentId,
      });
      return { ok: true };
    },
  },
  // ── databases ────────────────────────────────────────────────────────
  {
    id: 'databases.list',
    description: 'List inline databases in the workspace.',
    scope: 'databases:read',
    destructive: false,
    inputSchema: Empty,
    handler: async (ctx) => {
      const { eq } = await import('drizzle-orm');
      const { getDb } = await import('@/db/client');
      const schema = await import('@/db/schema');
      const rows = await getDb()
        .select({
          id: schema.databases.id,
          name: schema.databases.name,
          pageId: schema.databases.pageId,
        })
        .from(schema.databases)
        .where(eq(schema.databases.workspaceId, ctx.workspaceId));
      return { items: rows };
    },
  },
  {
    id: 'databases.read',
    description: 'Read a database (schema + view list).',
    scope: 'databases:read',
    destructive: false,
    inputSchema: DatabaseIdArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { getDatabaseWithMeta } = await import('@/lib/databases/get');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = DatabaseIdArg.parse(args);
      const meta = await getDatabaseWithMeta(getDb(), {
        databaseId: parsed.databaseId,
        workspaceId: ctx.workspaceId,
      });
      if (!meta) throw new HttpError(404, 'Database not found');
      return meta;
    },
  },
  {
    id: 'databases.create_row',
    description: 'Create a new row in a database (cells keyed by property id).',
    scope: 'databases:write',
    destructive: false,
    inputSchema: CreateRowArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { createRow } = await import('@/lib/databases/rows');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = CreateRowArg.parse(args);
      if (!ctx.userId) throw new HttpError(403, 'Token missing user identity');
      return createRow(getDb(), {
        databaseId: parsed.databaseId,
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        cells: parsed.cells,
      });
    },
  },
  {
    id: 'databases.update_row',
    description: 'Update a row in a database (replace specified cells).',
    scope: 'databases:write',
    destructive: false,
    inputSchema: UpdateRowCellsArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { updateCells } = await import('@/lib/databases/rows');
      const parsed = UpdateRowCellsArg.parse(args);
      await updateCells(getDb(), {
        rowId: parsed.rowId,
        databaseId: parsed.databaseId,
        workspaceId: ctx.workspaceId,
        cells: parsed.cells,
      });
      return { ok: true };
    },
  },
  {
    id: 'databases.delete_row',
    description: 'Archive (soft-delete) a row in a database.',
    scope: 'databases:destructive',
    destructive: true,
    inputSchema: RowRefArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { archiveRow } = await import('@/lib/databases/rows');
      const parsed = RowRefArg.parse(args);
      await archiveRow(getDb(), {
        rowId: parsed.rowId,
        databaseId: parsed.databaseId,
        workspaceId: ctx.workspaceId,
      });
      return { ok: true };
    },
  },
  // ── rows ─────────────────────────────────────────────────────────────
  {
    id: 'rows.list',
    description: 'List rows of a database (paginated).',
    scope: 'databases:read',
    destructive: false,
    inputSchema: ListRowsArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { listRows } = await import('@/lib/databases/rows');
      const parsed = ListRowsArg.parse(args);
      const rows = await listRows(getDb(), {
        databaseId: parsed.databaseId,
        workspaceId: ctx.workspaceId,
        limit: parsed.limit,
        offset: parsed.offset,
      });
      return { items: rows };
    },
  },
  {
    id: 'rows.update_cells',
    description:
      'Update cells on an existing row (alias of databases.update_row, kept for ergonomics).',
    scope: 'databases:write',
    destructive: false,
    inputSchema: UpdateRowCellsArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { updateCells } = await import('@/lib/databases/rows');
      const parsed = UpdateRowCellsArg.parse(args);
      await updateCells(getDb(), {
        rowId: parsed.rowId,
        databaseId: parsed.databaseId,
        workspaceId: ctx.workspaceId,
        cells: parsed.cells,
      });
      return { ok: true };
    },
  },
  // ── search ────────────────────────────────────────────────────────────
  {
    id: 'search.fts',
    description: 'Full-text search across the workspace (Postgres FTS + trigram).',
    scope: 'pages:read',
    destructive: false,
    inputSchema: SearchFtsArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { searchPages } = await import('@/lib/pages/search');
      const parsed = SearchFtsArg.parse(args);
      const results = await searchPages(getDb(), {
        workspaceId: ctx.workspaceId,
        query: parsed.query,
        limit: parsed.limit,
      });
      return { results };
    },
  },
  // ── comments ──────────────────────────────────────────────────────────
  {
    id: 'comments.list',
    description: 'List comments on a page.',
    scope: 'comments:read',
    destructive: false,
    inputSchema: ListCommentsArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { listComments } = await import('@/lib/comments/list');
      const parsed = ListCommentsArg.parse(args);
      const items = await listComments(getDb(), parsed.pageId, ctx.workspaceId);
      return { items };
    },
  },
  {
    id: 'comments.create',
    description: 'Create a comment on a page.',
    scope: 'comments:write',
    destructive: false,
    inputSchema: CreateCommentArg,
    handler: async (ctx, args) => {
      const { getDb } = await import('@/db/client');
      const { createComment } = await import('@/lib/comments/create');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = CreateCommentArg.parse(args);
      if (!ctx.userId) throw new HttpError(403, 'Token missing user identity');
      return createComment(getDb(), {
        workspaceId: ctx.workspaceId,
        authorId: ctx.userId,
        body: parsed.body,
        target: { type: 'page', id: parsed.pageId },
      });
    },
  },
  // ── files ─────────────────────────────────────────────────────────────
  {
    id: 'files.list',
    description: 'List uploaded files in the workspace (optionally scoped to a page).',
    scope: 'files:read',
    destructive: false,
    inputSchema: ListFilesArg,
    handler: async (ctx, args) => {
      const { and, desc, eq } = await import('drizzle-orm');
      const { getDb } = await import('@/db/client');
      const schema = await import('@/db/schema');
      const parsed = ListFilesArg.parse(args);
      const where = parsed.pageId
        ? and(eq(schema.files.workspaceId, ctx.workspaceId), eq(schema.files.pageId, parsed.pageId))
        : eq(schema.files.workspaceId, ctx.workspaceId);
      const rows = await getDb()
        .select({
          id: schema.files.id,
          name: schema.files.name,
          mimeType: schema.files.mimeType,
          size: schema.files.size,
          pageId: schema.files.pageId,
          createdAt: schema.files.createdAt,
        })
        .from(schema.files)
        .where(where)
        .orderBy(desc(schema.files.createdAt))
        .limit(parsed.limit);
      return { items: rows };
    },
  },
  {
    id: 'files.read_signed_url',
    description: 'Mint an HMAC-signed short-lived URL for downloading a file.',
    scope: 'files:read',
    destructive: false,
    inputSchema: FileIdArg,
    handler: async (ctx, args) => {
      const { and, eq } = await import('drizzle-orm');
      const { getDb } = await import('@/db/client');
      const schema = await import('@/db/schema');
      const { signFileUrl } = await import('@/lib/files/signing');
      const { env } = await import('@/lib/env');
      const { HttpError } = await import('@/lib/auth/require-role');
      const parsed = FileIdArg.parse(args);
      const [file] = await getDb()
        .select({ id: schema.files.id })
        .from(schema.files)
        .where(
          and(eq(schema.files.id, parsed.fileId), eq(schema.files.workspaceId, ctx.workspaceId)),
        )
        .limit(1);
      if (!file) throw new HttpError(404, 'File not found');
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
      const sig = signFileUrl({ fileId: file.id, expiresAt, secret: env().AUTH_SECRET });
      return {
        url: `/api/files/${file.id}?sig=${sig}&exp=${expiresAt}`,
        expiresAt,
      };
    },
  },
  // ── workspaces ────────────────────────────────────────────────────────
  {
    id: 'workspaces.info',
    description: 'Return basic info about the active workspace (id, name, slug, member count).',
    scope: 'pages:read',
    destructive: false,
    inputSchema: Empty,
    handler: async (ctx) => {
      const { getDb } = await import('@/db/client');
      const { getWorkspaceInfo } = await import('@/lib/workspaces/info');
      return getWorkspaceInfo(getDb(), { workspaceId: ctx.workspaceId });
    },
  },
];

/** O(1) lookup by id. Built once at module load. */
export const toolMap: Map<string, ToolDescriptor> = new Map(registry.map((t) => [t.id, t]));
