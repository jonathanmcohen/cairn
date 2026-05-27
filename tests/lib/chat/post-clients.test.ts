import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postToChat } from '@/lib/chat/post-clients';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('postToChat', () => {
  it('POSTs to slack chat.postMessage with bearer token', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await postToChat({ platform: 'slack', channelId: 'C1', body: 'hi', botToken: 'xoxb-1' });
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('https://slack.com/api/chat.postMessage');
    const init = call?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer xoxb-1');
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C1', text: 'hi' });
  });

  it('POSTs to discord channels/:id/messages with Bot token', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    await postToChat({ platform: 'discord', channelId: '12345', body: 'hi', botToken: 'tok' });
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('https://discord.com/api/v10/channels/12345/messages');
    const init = call?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bot tok');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hi' });
  });

  it('throws when slack returns non-2xx', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('bad', { status: 500 }),
    );
    await expect(
      postToChat({ platform: 'slack', channelId: 'C1', body: 'hi', botToken: 'x' }),
    ).rejects.toThrow(/slack/);
  });

  it('throws when discord returns non-2xx', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('bad', { status: 500 }),
    );
    await expect(
      postToChat({ platform: 'discord', channelId: 'C1', body: 'hi', botToken: 'x' }),
    ).rejects.toThrow(/discord/);
  });
});
