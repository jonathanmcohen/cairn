import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/config')>('@/lib/auth/config');
  let session: unknown = null;
  return {
    ...actual,
    auth: vi.fn(async () => session),
    __set: (s: unknown) => {
      session = s;
    },
  };
});

vi.mock('@/lib/url', () => ({ publicOrigin: vi.fn(async () => 'https://cairn.example.com') }));

vi.mock('@/lib/auth/require-role', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/require-role')>('@/lib/auth/require-role');
  return {
    ...actual,
    requireRole: vi.fn(async () => ({
      userId: 'u1',
      workspaceId: 'ws1',
      role: 'admin' as const,
    })),
  };
});

describe('GET chat-bridge oauth start', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(40);
    process.env.CAIRN_SLACK_CLIENT_ID = 'SLACK_CID';
    // The sandbox has no DNS resolver; let assertPublicUrl short-circuit so the
    // redirect-URI builder does not attempt to resolve cairn.example.com.
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
  });
  afterEach(() => {
    process.env.CAIRN_SLACK_CLIENT_ID = undefined;
    // biome-ignore lint/performance/noDelete: must remove the key, not set it
    // to the string "undefined" (which is truthy in the route's guard).
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });

  it('redirects to slack.com authorize with state + redirect_uri', async () => {
    const { GET } = await import('@/app/api/admin/chat-bridge/oauth/slack/start/route');
    const res = await GET(
      new Request('https://cairn.example.com/api/admin/chat-bridge/oauth/slack/start'),
    );
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin).toBe('https://slack.com');
    expect(loc.searchParams.get('client_id')).toBe('SLACK_CID');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('redirect_uri')).toContain('/slack/callback');
  });

  it('500s when the client id env is missing', async () => {
    // biome-ignore lint/performance/noDelete: must remove the key, not set it
    // to the string "undefined" (which is truthy in the route's guard).
    delete process.env.CAIRN_SLACK_CLIENT_ID;
    const { GET } = await import('@/app/api/admin/chat-bridge/oauth/slack/start/route');
    const res = await GET(new Request('https://cairn.example.com/x'));
    expect(res.status).toBe(500);
  });
});
