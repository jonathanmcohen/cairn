/**
 * v0.10.0 C2 — backup bundle upload (admin/owner only).
 *
 * POST multipart `file` accepts exactly the artefacts `cli restore` can
 * consume: a pg_dump custom-format archive (`.dump`) or its encrypted
 * envelope (`.dump.enc`). Uploads-tar restore stays out of C2 scope — the
 * restore CLI restores the DB dump and merely warns when no uploads archive
 * matches the bundle timestamp.
 *
 * The body is magic-sniffed (src/lib/backups/sniff.ts) BEFORE anything lands
 * under its final name: junk → 400 with nothing persisted; valid bundles are
 * written to a temp name and renamed into CAIRN_BACKUP_DIR as
 * `cairn-backup-<ts>-uploaded.dump[.enc]` with a minimal sibling manifest so
 * the C1 list (and the restore route) can see it. Manifest fields use the
 * 'uploaded' sentinel for version/database since the real values are unknown.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { SNIFF_BYTES, sniffBackupUpload } from '@/lib/backups/sniff';
import { env } from '@/lib/env';

/**
 * Same env knob as /api/upload (CAIRN_MAX_UPLOAD_MB, default 25 MB): read
 * process.env directly so tests/operators can toggle it without the cached
 * env(). Operators uploading large production dumps must raise it.
 */
function maxUploadBytes(): number {
  const raw = process.env.CAIRN_MAX_UPLOAD_MB;
  const mb = raw !== undefined ? Number(raw) : env().CAIRN_MAX_UPLOAD_MB;
  if (!Number.isFinite(mb) || mb <= 0) return env().CAIRN_MAX_UPLOAD_MB * 1024 * 1024;
  return mb * 1024 * 1024;
}

export async function POST(req: Request): Promise<Response> {
  try {
    await requireRole('admin');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing file field' }, { status: 400 });
    }
    if (file.size > maxUploadBytes()) {
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    }

    const body = Buffer.from(await file.arrayBuffer());
    const sniff = sniffBackupUpload(file.name, body.subarray(0, SNIFF_BYTES));
    if (!sniff.ok) {
      return NextResponse.json({ error: sniff.reason }, { status: 400 });
    }

    const dir = env().CAIRN_BACKUP_DIR;
    await mkdir(dir, { recursive: true });
    // Same stamp shape as the backup CLI + '-uploaded' so the provenance is
    // visible in the bundle list and names can never collide with cron's.
    const ts = `${new Date().toISOString().replace(/[:.]/g, '-')}-uploaded`;
    const finalName = `cairn-backup-${ts}.dump${sniff.kind === 'dump.enc' ? '.enc' : ''}`;
    const tmpPath = join(dir, `.upload-${randomUUID()}.tmp`);
    try {
      await writeFile(tmpPath, body);
      await rename(tmpPath, join(dir, finalName));
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
    await writeFile(
      join(dir, `cairn-backup-${ts}.manifest.json`),
      JSON.stringify(
        {
          version: 'uploaded',
          createdAt: new Date().toISOString(),
          fileBackend: 'local',
          database: 'uploaded',
          encrypted: sniff.kind === 'dump.enc',
        },
        null,
        2,
      ),
    );

    return NextResponse.json({ ts }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
