import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { checkStorageQuota, incrementStorageUsed } from '@/lib/quotas/quota';
import { signFileUrl } from './signing';
import type { FileStorage } from './storage';

/**
 * Server-side MIME allowlist. Re-exported so the bulk-upload client UI
 * (v0.9.0 G3 P22) can use the SAME constant to drive its `accept=` filter and
 * pre-upload classification — defense-in-depth: every accepted MIME here is
 * still re-validated server-side inside `storeUpload`.
 */
export const ALLOWED_UPLOAD_MIME: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
  // v0.8.0 P24: video upload block (mp4/webm). Quota enforcement (v0.6.0 P21)
  // already applies to every storeUpload call regardless of MIME — extending
  // the allowlist is the only change needed here.
  'video/mp4',
  'video/webm',
  // v0.9.0 G3 P22: audio block + bulk drag-drop. Five common audio MIME types
  // — the same set the client `BulkUploader` classifies as `kind: 'audio'`.
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
]);

/** Pure predicate over `ALLOWED_UPLOAD_MIME` — the single source of truth. */
export function isAllowedMime(mime: string): boolean {
  return ALLOWED_UPLOAD_MIME.has(mime);
}

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type StoreUploadInput = {
  db: PostgresJsDatabase<typeof schema>;
  storage: FileStorage;
  secret: string;
  workspaceId: string;
  uploadedBy: string;
  pageId?: string;
  filename: string;
  mimeType: string;
  body: Buffer;
};

export type StoreUploadResult = {
  file: schema.FileRow;
  signedUrl: string;
};

export async function storeUpload(input: StoreUploadInput): Promise<StoreUploadResult> {
  if (!isAllowedMime(input.mimeType)) {
    throw new Error(`mime type not allowed: ${input.mimeType}`);
  }
  const id = randomUUID();
  const ext = extname(input.filename).toLowerCase().slice(0, 8);
  const path = `${input.workspaceId}/${id}${ext}`;

  const file = await input.db.transaction(async (tx) => {
    // Reject BEFORE writing the blob if it would breach the quota.
    await checkStorageQuota(tx, {
      workspaceId: input.workspaceId,
      incomingBytes: input.body.length,
    });
    // Put the blob inside the txn so a downstream insert failure rolls back
    // both rows — an orphan blob (no files row) is invisible to the counter
    // and reconcileQuota is the drift backstop.
    await input.storage.put(path, input.body, input.mimeType);
    const [row] = await tx
      .insert(schema.files)
      .values({
        id,
        workspaceId: input.workspaceId,
        pageId: input.pageId ?? null,
        name: input.filename,
        mimeType: input.mimeType,
        size: input.body.length,
        path,
        uploadedBy: input.uploadedBy,
      })
      .returning();
    if (!row) throw new Error('file insert returned no row');
    await incrementStorageUsed(tx, input.workspaceId, input.body.length);
    return row;
  });

  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const sig = signFileUrl({ fileId: file.id, expiresAt, secret: input.secret });
  const signedUrl = `/api/files/${file.id}?sig=${sig}&exp=${expiresAt}`;

  return { file, signedUrl };
}
