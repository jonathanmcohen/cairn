import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  getAuthContext: vi.fn(async () => ({ userId: 'u1', workspaceId: 'ws1', role: 'admin' })),
}));
vi.mock('@/lib/url', () => ({ publicOrigin: vi.fn(async () => 'https://notes.example.com') }));
vi.mock('@/lib/version', () => ({ appVersion: () => '9.9.9' }));

import { __resetCache, GET } from '@/app/openapi.json/route';

beforeEach(() => __resetCache());
afterEach(() => vi.clearAllMocks());

describe('GET /openapi.json', () => {
  it('embeds the public origin in servers and the app version in info', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      servers: { url: string }[];
      info: { version: string };
    };
    expect(doc.servers[0]?.url).toBe('https://notes.example.com');
    expect(doc.info.version).toBe('9.9.9');
  });
});
