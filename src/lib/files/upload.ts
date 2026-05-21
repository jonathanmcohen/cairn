import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import * as schema from '@/db/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { signFileUrl } from './signing';
import type { FileStorage } from './storage';

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
]);

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
  if (!ALLOWED.has(input.mimeType)) {
    throw new Error(`mime type not allowed: ${input.mimeType}`);
  }
  const id = randomUUID();
  const ext = extname(input.filename).toLowerCase().slice(0, 8);
  const path = `${input.workspaceId}/${id}${ext}`;
  await input.storage.put(path, input.body, input.mimeType);

  const [file] = await input.db
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
  if (!file) throw new Error('file insert returned no row');

  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const sig = signFileUrl({ fileId: file.id, expiresAt, secret: input.secret });
  const signedUrl = `/api/files/${file.id}?sig=${sig}&exp=${expiresAt}`;

  return { file, signedUrl };
}
