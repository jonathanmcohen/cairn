/**
 * v0.10.2 S6 — `resolveWorkspaceIconUrl` mints the WorkspaceSwitcher chip's
 * signed file URL. `file::<uuid>` → `/api/files/<uuid>?sig=&exp=` whose sig
 * matches `signFileUrl` for the same fileId+exp; everything else → null.
 */
import { describe, expect, it } from 'vitest';
import { signFileUrl } from '@/lib/files/signing';
import { resolveWorkspaceIconUrl } from '@/lib/workspaces/list';

const FILE_ID = '123e4567-e89b-12d3-a456-426614174000';
const SECRET = 's3cret';

describe('resolveWorkspaceIconUrl (S6)', () => {
  it('mints a signed /api/files URL for file:: icons (1 h TTL)', () => {
    const before = Math.floor(Date.now() / 1000);
    const url = resolveWorkspaceIconUrl(`file::${FILE_ID}`, SECRET);
    const after = Math.floor(Date.now() / 1000);

    expect(url).toMatch(new RegExp(`^/api/files/${FILE_ID}\\?sig=[0-9a-f]{64}&exp=\\d+$`));
    const match = url?.match(/\?sig=([0-9a-f]{64})&exp=(\d+)$/);
    const sig = match?.[1];
    const exp = Number(match?.[2]);
    // exp is now + 3600 (computed internally; bracket it with our own clock).
    expect(exp).toBeGreaterThanOrEqual(before + 3600);
    expect(exp).toBeLessThanOrEqual(after + 3600);
    // The sig must be exactly what signFileUrl produces for fileId+exp.
    expect(sig).toBe(signFileUrl({ fileId: FILE_ID, expiresAt: exp, secret: SECRET }));
  });

  it('returns null for emoji icons', () => {
    expect(resolveWorkspaceIconUrl('emoji::🪨', SECRET)).toBeNull();
  });

  it('returns null when no icon is set', () => {
    expect(resolveWorkspaceIconUrl(null, SECRET)).toBeNull();
  });

  it('returns null for malformed file:: payloads (non-uuid → legacy emoji bucket)', () => {
    expect(resolveWorkspaceIconUrl('file::not-a-uuid', SECRET)).toBeNull();
  });
});
