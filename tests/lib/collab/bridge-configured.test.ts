import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCollabBridgeConfigured } from '@/lib/collab/publish-client';

// v0.9.19 A4 (#A3) — the env-detect that drives the boot warning + admin banner
// when the REST→Yjs publish bridge is OFF (the v0.9.18 live miss). The helper
// reads process.env directly, so we snapshot + restore the two vars per case.
describe('isCollabBridgeConfigured', () => {
  const saved = {
    url: process.env.CAIRN_COLLAB_INTERNAL_URL,
    secret: process.env.AUTH_SECRET,
  };
  beforeEach(() => {
    delete process.env.CAIRN_COLLAB_INTERNAL_URL;
    delete process.env.AUTH_SECRET;
  });
  afterEach(() => {
    if (saved.url === undefined) delete process.env.CAIRN_COLLAB_INTERNAL_URL;
    else process.env.CAIRN_COLLAB_INTERNAL_URL = saved.url;
    if (saved.secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.secret;
  });

  it('is false when CAIRN_COLLAB_INTERNAL_URL is unset (the disabled deployment)', () => {
    process.env.AUTH_SECRET = 'secret';
    expect(isCollabBridgeConfigured()).toBe(false);
  });

  it('is false when AUTH_SECRET is unset (cannot authenticate the internal call)', () => {
    process.env.CAIRN_COLLAB_INTERNAL_URL = 'http://localhost:1234';
    expect(isCollabBridgeConfigured()).toBe(false);
  });

  it('is true only when both are present', () => {
    process.env.CAIRN_COLLAB_INTERNAL_URL = 'http://localhost:1234';
    process.env.AUTH_SECRET = 'secret';
    expect(isCollabBridgeConfigured()).toBe(true);
  });

  it('the entrypoint warns at boot when the bridge URL is unset', () => {
    const src = readFileSync('src/server/entrypoint.ts', 'utf8');
    expect(src).toContain('if (!process.env.CAIRN_COLLAB_INTERNAL_URL)');
    expect(src).toContain('[collab] API↔Yjs bridge is DISABLED');
  });

  it('the admin upgrade page renders a banner gated on the bridge check', () => {
    const src = readFileSync('src/app/(app)/settings/admin/upgrade/page.tsx', 'utf8');
    expect(src).toContain('isCollabBridgeConfigured()');
    expect(src).toContain('data-testid="collab-bridge-warning"');
  });
});
