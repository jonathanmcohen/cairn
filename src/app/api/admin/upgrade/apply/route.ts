/**
 * v0.9.0 G8 P42 — admin SSE route for `cairn-upgrade apply`.
 *
 * POST is gated by `requireRole('admin')`: returns 401 if unauthenticated,
 * 403 if the caller is below admin in the active workspace. On success the
 * response is `Content-Type: text/event-stream`, with one
 * `data: <JSON>\n\n` event per `ProgressEvent` the orchestrator emits.
 *
 * Auto-apply remains OFF by default — the cron daemon (P42 Task 3) only
 * notifies. This route is the only path that actually invokes
 * `applyUpgrade`. Errors that escape `applyUpgrade` are surfaced as a
 * single `{ stage: 'failed', message }` SSE event; the response never
 * crashes the stream.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import { applyUpgrade, type ProgressEvent } from '@/lib/upgrade/apply';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request): Promise<Response> {
  let ctx: { userId: string; workspaceId: string };
  try {
    const c = await requireRole('admin');
    ctx = { userId: c.userId, workspaceId: c.workspaceId };
  } catch (err) {
    if (err instanceof HttpError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Read the bundled package.json for from/to version metadata. The
  // applyUpgrade auditing path expects both — fromVersion is the running
  // tag, toVersion is the target. We pass the same value: this route is
  // invoked AFTER an image swap (the operator pulled the new tag, the
  // process is running the new code) and the audit row reflects the new
  // package.json#version on both sides.
  let pkgVersion: string;
  try {
    const pkg = JSON.parse(
      await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };
    pkgVersion = pkg.version;
  } catch {
    pkgVersion = process.env.npm_package_version ?? 'unknown';
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (e: ProgressEvent): void => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // Stream already closed (client disconnected). The apply
          // continues to completion; we just stop emitting.
        }
      };
      try {
        const result = await applyUpgrade({
          databaseUrl: env().DATABASE_URL,
          backupDir: process.env.CAIRN_BACKUP_DIR ?? '/data/backups',
          fromVersion: pkgVersion,
          toVersion: pkgVersion,
          workspaceId: ctx.workspaceId,
          onProgress: push,
        });
        if (!result.ok) {
          // applyUpgrade already emitted `failed` (or `done`) via
          // onProgress — no need to push twice. But if a failure case
          // somehow short-circuited before `emit({ stage: 'failed' })`,
          // surface a final marker so the client knows the stream ended.
          push({ stage: 'failed', message: result.error ?? 'apply failed' });
        }
      } catch (err) {
        push({ stage: 'failed', message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
