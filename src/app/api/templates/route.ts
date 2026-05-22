import { and, asc, desc, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { saveDatabaseAsTemplate, savePageAsTemplate } from '@/lib/templates/save';

export type TemplateListRow = {
  id: string;
  name: string;
  kind: string;
  builtIn: boolean;
};

const SaveTemplate = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('page'),
    name: z.string().trim().min(1).max(200),
    pageId: z.uuid(),
  }),
  z.object({
    kind: z.literal('database'),
    name: z.string().trim().min(1).max(200),
    databaseId: z.uuid(),
    withSampleRows: z.boolean().optional(),
  }),
]);

/** List built-in (global) templates plus templates owned by the active workspace. */
export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
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
    return NextResponse.json({ templates: rows satisfies TemplateListRow[] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Save a page subtree or a database as a workspace template (editor+). */
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const parsed = SaveTemplate.parse(await req.json());
    const db = getDb();

    if (parsed.kind === 'page') {
      // Confirm the page belongs to the active workspace before capturing it.
      const [page] = await db
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(
          and(eq(schema.pages.id, parsed.pageId), eq(schema.pages.workspaceId, ctx.workspaceId)),
        )
        .limit(1);
      if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const tpl = await savePageAsTemplate(db, {
        workspaceId: ctx.workspaceId,
        rootPageId: parsed.pageId,
        name: parsed.name,
      });
      return NextResponse.json(
        { template: { id: tpl.id, name: tpl.name, kind: tpl.kind, builtIn: tpl.builtIn } },
        { status: 201 },
      );
    }

    const [database] = await db
      .select({ id: schema.databases.id })
      .from(schema.databases)
      .where(
        and(
          eq(schema.databases.id, parsed.databaseId),
          eq(schema.databases.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1);
    if (!database) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const tpl = await saveDatabaseAsTemplate(db, {
      workspaceId: ctx.workspaceId,
      databaseId: parsed.databaseId,
      name: parsed.name,
      withSampleRows: parsed.withSampleRows,
    });
    return NextResponse.json(
      { template: { id: tpl.id, name: tpl.name, kind: tpl.kind, builtIn: tpl.builtIn } },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}
