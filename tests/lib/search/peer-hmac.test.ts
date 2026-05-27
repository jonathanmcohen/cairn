import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNonceLruForTests,
  signEnvelope,
  verifyEnvelopeWithBody,
} from '@/lib/search/peer-hmac';

const secret = 'test-shared-secret-aaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  __resetNonceLruForTests();
});

describe('peer-hmac', () => {
  it('signEnvelope returns deterministic headers + JSON body', () => {
    const fixedTs = 1_700_000_000_000;
    const r = signEnvelope({ q: 'hello', workspaceScope: 'all', ts: fixedTs, nonce: 'n1' }, secret);
    expect(r.headers['x-cairn-peer-ts']).toBe(String(fixedTs));
    expect(r.headers['x-cairn-peer-nonce']).toBe('n1');
    expect(r.headers['x-cairn-peer-sig']).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(r.body)).toEqual({ q: 'hello', workspaceScope: 'all' });
  });

  it('verifyEnvelopeWithBody accepts a freshly signed request', async () => {
    const ts = Date.now();
    const signed = signEnvelope({ q: 'hello', workspaceScope: 'all', ts, nonce: 'n1' }, secret);
    const req = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const body = await req.text();
    const r = verifyEnvelopeWithBody(req.headers, body, [{ name: 'p1', secret }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.peerName).toBe('p1');
  });

  it('rejects tampered body (deterministic flip of first byte)', async () => {
    const ts = Date.now();
    const signed = signEnvelope({ q: 'hello', workspaceScope: 'all', ts, nonce: 'n2' }, secret);
    const tampered = `Z${signed.body.slice(1)}`;
    const req = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: tampered,
    });
    const body = await req.text();
    const r = verifyEnvelopeWithBody(req.headers, body, [{ name: 'p1', secret }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('malformed');
  });

  it('rejects stale ts (>300s skew)', async () => {
    const ts = Date.now() - 301_000;
    const signed = signEnvelope({ q: 'hello', workspaceScope: 'all', ts, nonce: 'n3' }, secret);
    const req = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const body = await req.text();
    const r = verifyEnvelopeWithBody(req.headers, body, [{ name: 'p1', secret }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('stale');
  });

  it('rejects replay of the same nonce within the window', async () => {
    const ts = Date.now();
    const signed = signEnvelope(
      { q: 'hello', workspaceScope: 'all', ts, nonce: 'replay-nonce' },
      secret,
    );
    const req1 = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const body1 = await req1.text();
    expect(verifyEnvelopeWithBody(req1.headers, body1, [{ name: 'p1', secret }]).ok).toBe(true);

    const req2 = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const body2 = await req2.text();
    const r = verifyEnvelopeWithBody(req2.headers, body2, [{ name: 'p1', secret }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('replay');
  });

  it('rejects when no matching secret is supplied', async () => {
    const ts = Date.now();
    const signed = signEnvelope({ q: 'hello', workspaceScope: 'all', ts, nonce: 'n5' }, secret);
    const req = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const body = await req.text();
    const r = verifyEnvelopeWithBody(req.headers, body, [
      { name: 'p1', secret: 'different-secret' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('bad_signature');
  });

  it('rejects with unknown_peer when no peers are configured', async () => {
    const ts = Date.now();
    const signed = signEnvelope({ q: 'hello', workspaceScope: 'all', ts, nonce: 'n6' }, secret);
    const req = new Request('http://x/peer', {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const body = await req.text();
    const r = verifyEnvelopeWithBody(req.headers, body, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unknown_peer');
  });

  it('rejects malformed headers (missing ts)', async () => {
    const r = verifyEnvelopeWithBody(
      new Headers({
        'x-cairn-peer-nonce': 'n7',
        'x-cairn-peer-sig': 'deadbeef'.repeat(8),
      }),
      JSON.stringify({ q: 'x', workspaceScope: 'all' }),
      [{ name: 'p1', secret }],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('malformed');
  });
});
