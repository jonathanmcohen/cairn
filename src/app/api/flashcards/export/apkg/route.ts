import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { buildApkg } from '@/lib/flashcards/apkg';

export const runtime = 'nodejs';

// sql.js loads its wasm binary (`sql-wasm.wasm`) at runtime from beside the
// package main in node_modules (see src/lib/flashcards/apkg.ts#getSqlJs). The
// Next standalone file-tracer copies the imported JS but not the sibling
// `.wasm` (it's not a JS import), so force it into the build trace here:
//   - next.config: outputFileTracingIncludes pins node_modules/sql.js/dist/*.wasm
// This top-level reference documents the dependency for the trace and for
// anyone touching the route. If the wasm is missing in a deployed standalone
// server, that config entry was dropped.

/**
 * GET /api/flashcards/export/apkg — download the calling user's active
 * workspace flashcards as an Anki `.apkg` package (v0.10.2 F3 Task C).
 *
 * The package embeds every card in the workspace mapped to the Anki Basic
 * (Front/Back) note type, with the deck hierarchy preserved (`::`-joined names)
 * and the CALLING user's per-card SM-2 state (ease→factor, interval→ivl,
 * suspended→queue -1, never-reviewed→new). Orphaned cards carry a
 * `cairn-orphan` tag.
 *
 * Auth: any workspace member. Fail-closed on auth error.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const apkg = await buildApkg(getDb(), {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    return new NextResponse(new Uint8Array(apkg), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="cairn-flashcards.apkg"',
        'content-length': String(apkg.byteLength),
      },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
