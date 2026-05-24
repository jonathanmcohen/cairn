import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { runWorkspaceExport } from '@/lib/export/workspace-archive';
import { getStorage } from '@/lib/files/get-storage';
import { signFileUrl } from '@/lib/files/signing';

export const runtime = 'nodejs';

/** Short-TTL signed download URLs (5 minutes). */
const DOWNLOAD_TTL_SECONDS = 300;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Run a workspace export, mirror the produced archive to FileStorage under
 * `backups/`, sign a short-TTL URL, and return JSON with the signed URL +
 * storage key. Admin-only; cannot target a workspace other than the one
 * currently active in the admin's session.
 */
export async function POST(req: Request): Promise<Response> {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.message);
    return jsonError(500, err instanceof Error ? err.message : 'unknown');
  }

  let body: { workspaceId?: string };
  try {
    body = (await req.json()) as { workspaceId?: string };
  } catch {
    return jsonError(400, 'invalid json');
  }
  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return jsonError(400, 'workspaceId required');
  }
  if (ctx.workspaceId !== workspaceId) {
    return jsonError(403, 'cannot export a different workspace');
  }

  const outDir = await mkdtemp(join(tmpdir(), 'cairn-export-'));
  try {
    const archivePath = await runWorkspaceExport({ workspaceId, outDir });
    const archiveBlob = await readFile(archivePath);

    // Mirror to FileStorage under `backups/` — same convention as the
    // v0.6 P21 `backup --target s3` path.
    const key = `backups/${basename(archivePath)}`;
    const storage = getStorage();
    await storage.put(key, archiveBlob, 'application/zip');

    // Sign a short-TTL URL. Reuses the v0.5 P2 HMAC primitive
    // (fileId-of-anything + expiresAt) with `fileId := <storage key>`.
    const expiresAt = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
    const secret = env().AUTH_SECRET;
    const sig = signFileUrl({ fileId: key, expiresAt, secret });
    const url = `/api/exports/download?key=${encodeURIComponent(key)}&sig=${sig}&exp=${expiresAt}`;

    return new Response(JSON.stringify({ url, key, sizeBytes: archiveBlob.byteLength }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } finally {
    // Best-effort cleanup of the local temp dir — the canonical copy lives
    // in FileStorage now.
    rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}
