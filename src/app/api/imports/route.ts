import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { runImport } from '@/lib/import/run';

export const runtime = 'nodejs';

type ImportSource = 'notion' | 'markdown-folder' | 'workspace-archive';
const VALID_SOURCES: ImportSource[] = ['notion', 'markdown-folder', 'workspace-archive'];

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Multipart import endpoint. Admin-only. Persists the upload to a tmp dir,
 * invokes the v0.6 P21 `runImport` dispatcher, and streams Server-Sent Events
 * back to the browser so the UI can show progress.
 *
 * Events: `progress` ({phase}) → ... → `done` (ImportReport) on success, or
 * `error` ({message}) on failure. Heartbeats (comment lines) keep the
 * connection alive across proxies.
 */
export async function POST(req: Request): Promise<Response> {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.message);
    return jsonError(500, err instanceof Error ? err.message : 'unknown');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'invalid multipart');
  }

  const file = form.get('file');
  const source = form.get('source');
  const workspaceId = form.get('workspaceId');
  if (!(file instanceof Blob) || typeof source !== 'string' || typeof workspaceId !== 'string') {
    return jsonError(400, 'missing fields');
  }
  if (!(VALID_SOURCES as string[]).includes(source)) {
    return jsonError(400, 'unknown source');
  }

  // Cross-workspace guard: only allow importing into the workspace currently
  // active in the admin's session.
  if (ctx.workspaceId !== workspaceId) {
    return jsonError(403, 'cannot import into a different workspace');
  }

  // Persist the upload so runImport can read it by path.
  const tmpDir = await mkdtemp(join(tmpdir(), 'cairn-import-'));
  const rawName = file instanceof File ? file.name : 'upload.bin';
  const safeName = basename(rawName) || 'upload.bin';
  const filePath = join(tmpDir, safeName);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buf);

  const actorUserId = ctx.userId;
  const importSource = source as ImportSource;
  const importWorkspaceId = workspaceId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown): void => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller already closed (e.g. client disconnect) — ignore.
        }
      };
      // Heartbeat every 30s — keeps proxies/CDNs from closing an idle stream.
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': hb\n\n'));
        } catch {
          // ignore
        }
      }, 30_000);
      try {
        emit('progress', { phase: 'reading' });
        const report = await runImport({
          source: importSource,
          file: filePath,
          workspaceId: importWorkspaceId,
          actorUserId,
        });
        emit('progress', { phase: 'done' });
        emit('done', report);
      } catch (err) {
        emit('error', { message: err instanceof Error ? err.message : 'unknown' });
      } finally {
        clearInterval(hb);
        // Best-effort cleanup of the temp dir.
        rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
