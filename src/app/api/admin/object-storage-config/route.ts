import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import {
  getStorageConfigForDisplay,
  STORAGE_PROVIDERS,
  StorageOptInError,
  saveStorageConfig,
} from '@/lib/files/storage-config';

const PutBody = z.object({
  provider: z.enum(STORAGE_PROVIDERS),
  endpoint: z.string().min(1),
  region: z.string().min(1),
  bucket: z.string().min(1),
  accessKey: z.string().nullable(),
  // Write-once: omit to keep the stored secret, send a non-empty string to
  // replace it. The form never sends a blank string back.
  secretKey: z.string().optional(),
  pathPrefix: z.string().nullable(),
  publicBucket: z.boolean(),
  uploadsEnabled: z.boolean(),
  backupsEnabled: z.boolean(),
  siemEnabled: z.boolean(),
});

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    return NextResponse.json(await getStorageConfigForDisplay(getDb()));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const body = PutBody.parse(await req.json());
    const accessKey = body.accessKey?.trim() ? body.accessKey.trim() : null;
    const pathPrefix = body.pathPrefix?.trim() ? body.pathPrefix.trim() : null;
    const secretKey =
      body.secretKey === undefined ? undefined : body.secretKey === '' ? null : body.secretKey;

    await saveStorageConfig(
      getDb(),
      {
        provider: body.provider,
        endpoint: body.endpoint.trim(),
        region: body.region.trim(),
        bucket: body.bucket.trim(),
        accessKey,
        secretKey,
        pathPrefix,
        publicBucket: body.publicBucket,
        uploadsEnabled: body.uploadsEnabled,
        backupsEnabled: body.backupsEnabled,
        siemEnabled: body.siemEnabled,
      },
      ctx.userId,
    );

    await recordAudit(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'config.storage_updated',
      targetType: 'instance_config',
      // target_id is a uuid column; the storage config is a singleton with no
      // uuid identity, so the type alone identifies it.
      metadata: {
        provider: body.provider,
        endpoint: body.endpoint.trim(),
        bucket: body.bucket.trim(),
        uploadsEnabled: body.uploadsEnabled,
        backupsEnabled: body.backupsEnabled,
        siemEnabled: body.siemEnabled,
      },
    });

    return NextResponse.json(await getStorageConfigForDisplay(getDb()));
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof StorageOptInError) {
    return NextResponse.json({ error: 'optin_requires_config' }, { status: 400 });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}
