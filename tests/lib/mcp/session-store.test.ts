import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenContext } from '@/lib/auth/token';
import {
  closeSession,
  createSession,
  getSession,
  resetSessionStore,
  SSE_SESSION_TTL_MS,
  sendToSession,
  sweepExpiredSessions,
} from '@/lib/mcp/session-store';

const ctx: TokenContext = {
  kind: 'pat',
  tokenId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  scopes: ['mcp:read'],
  mcpTools: ['pages.list'],
};

function fakeController() {
  const chunks: string[] = [];
  const dec = new TextDecoder();
  return {
    chunks,
    controller: {
      enqueue(chunk: Uint8Array) {
        chunks.push(dec.decode(chunk));
      },
      close() {},
      error(_e: unknown) {},
    } as unknown as ReadableStreamDefaultController<Uint8Array>,
  };
}

beforeEach(() => resetSessionStore());
afterEach(() => resetSessionStore());

describe('session-store', () => {
  it('createSession returns a uuid sessionId and stores the controller + tokenId', () => {
    const { controller } = fakeController();
    const { sessionId } = createSession(ctx, controller);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const sess = getSession(sessionId);
    expect(sess).toBeDefined();
    expect(sess?.tokenId).toBe(ctx.tokenId);
  });

  it('accepts a caller-supplied sessionId when valid uuid', () => {
    const { controller } = fakeController();
    const provided = '11111111-1111-4111-8111-111111111111';
    const { sessionId } = createSession(ctx, controller, provided);
    expect(sessionId).toBe(provided);
  });

  it('sendToSession writes an SSE message event to the controller', () => {
    const { chunks, controller } = fakeController();
    const { sessionId } = createSession(ctx, controller);
    sendToSession(sessionId, { jsonrpc: '2.0', id: 1, result: { ok: true } });
    const joined = chunks.join('');
    expect(joined).toContain('event: message');
    expect(joined).toContain('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
  });

  it('sendToSession is a no-op (returns false) for unknown sessionId', () => {
    expect(sendToSession('00000000-0000-4000-8000-000000000999', { foo: 'bar' })).toBe(false);
  });

  it('closeSession evicts the session and closes its controller', () => {
    const { controller } = fakeController();
    const closeSpy = vi.spyOn(controller, 'close');
    const { sessionId } = createSession(ctx, controller);
    expect(getSession(sessionId)).toBeDefined();
    closeSession(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('sweepExpiredSessions evicts sessions older than the TTL', () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    const a = createSession(ctx, fakeController().controller);
    vi.setSystemTime(t0 + SSE_SESSION_TTL_MS + 1);
    const b = createSession(ctx, fakeController().controller);
    sweepExpiredSessions();
    expect(getSession(a.sessionId)).toBeUndefined();
    expect(getSession(b.sessionId)).toBeDefined();
    vi.useRealTimers();
  });

  it('sendToSession touches lastSeenAt so active sessions are not swept', () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    const { controller } = fakeController();
    const { sessionId } = createSession(ctx, controller);
    vi.setSystemTime(t0 + SSE_SESSION_TTL_MS - 1000);
    sendToSession(sessionId, { jsonrpc: '2.0', id: 9, result: {} });
    vi.setSystemTime(t0 + SSE_SESSION_TTL_MS + 1);
    sweepExpiredSessions();
    expect(getSession(sessionId)).toBeDefined();
    vi.useRealTimers();
  });
});
