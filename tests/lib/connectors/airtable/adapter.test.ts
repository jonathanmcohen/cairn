import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorState, Diff } from '@/lib/connectors/adapter';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://x');
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-thirty-two-chars-min-aaaaaa');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
  vi.stubEnv('PUBLIC_URL', 'https://cairn.example.com');
  fetchMock = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);
});

import { AirtableAdapter } from '@/lib/connectors/airtable/adapter';

function makeState(over: Partial<ConnectorState> = {}): ConnectorState {
  return {
    connectorId: 'con-air-1',
    workspaceId: 'ws-1',
    authConfig: { pat: 'patABC', webhookMacSecret: 'bWFjLXNlY3JldA==' },
    syncConfig: {
      baseId: 'appBASE',
      tableId: 'tblTABLE',
      fieldMap: { 'prop-title': 'Title', 'prop-count': 'Count' },
      externalIdProperty: 'prop-title',
    },
    ...over,
  };
}

describe('AirtableAdapter.fetchAll', () => {
  it('paginates through offsets and maps fields to cairn-property cells', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [
              { id: 'rec1', fields: { Title: 'foo', Count: 1 } },
              { id: 'rec2', fields: { Title: 'bar', Count: 2 } },
            ],
            offset: 'next-page-token',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [{ id: 'rec3', fields: { Title: 'baz', Count: 3 } }],
          }),
          { status: 200 },
        ),
      );

    const rows = await AirtableAdapter.fetchAll(makeState());
    expect(rows).toHaveLength(3);
    expect(rows[0]?.externalId).toBe('rec1');
    expect(rows[0]?.cells['prop-title']).toBe('foo');
    expect(rows[2]?.cells['prop-count']).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call URL includes the offset.
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toContain('offset=next-page-token');
  });

  it('sends Authorization: Bearer <PAT> header from the plaintext authConfig.pat', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    await AirtableAdapter.fetchAll(makeState());
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer patABC');
  });

  it('throws when the list API returns non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(AirtableAdapter.fetchAll(makeState())).rejects.toThrow(/airtable\.list 500/);
  });
});

describe('AirtableAdapter.applyChanges — 10-record batch limit', () => {
  it('chunks 25 updates into 3 PATCH requests of 10/10/5', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    const updates = Array.from({ length: 25 }, (_, i) => ({
      externalId: `rec${i}`,
      cells: { 'prop-title': `t${i}`, 'prop-count': i },
    }));
    const diff: Diff = { creates: [], updates, deletes: [] };
    await AirtableAdapter.applyChanges(makeState(), diff);
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(3);
    const bodySizes = patchCalls.map(([, init]) => {
      const body = (init as RequestInit).body as string;
      return (JSON.parse(body) as { records: unknown[] }).records.length;
    });
    expect(bodySizes).toEqual([10, 10, 5]);
  });

  it('chunks 25 creates into 3 POST requests of 10/10/5', async () => {
    // Each call must return a *fresh* Response — bodies are single-use.
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const reqBody = JSON.parse((init?.body as string) ?? '{"records":[]}') as {
        records: Array<{ fields: Record<string, unknown> }>;
      };
      const records = reqBody.records.map((_, i) => ({ id: `recNEW${i}`, fields: {} }));
      return Promise.resolve(new Response(JSON.stringify({ records }), { status: 200 }));
    });
    const creates = Array.from({ length: 25 }, (_, i) => ({
      cairnRowId: `c-${i}`,
      cells: { 'prop-title': `t${i}` },
    }));
    const diff: Diff = { creates, updates: [], deletes: [] };
    await AirtableAdapter.applyChanges(makeState(), diff);
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(3);
    const bodySizes = postCalls.map(([, init]) => {
      const body = (init as RequestInit).body as string;
      return (JSON.parse(body) as { records: unknown[] }).records.length;
    });
    expect(bodySizes).toEqual([10, 10, 5]);
  });

  it('chunks 12 deletes into 2 DELETE requests of 10 + 2', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    const deletes = Array.from({ length: 12 }, (_, i) => ({ externalId: `rec${i}` }));
    const diff: Diff = { creates: [], updates: [], deletes };
    await AirtableAdapter.applyChanges(makeState(), diff);
    const delCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(delCalls).toHaveLength(2);
  });
});

describe('AirtableAdapter.applyChanges — acks', () => {
  it('emits one ack per update with the externalId carried through', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    const diff: Diff = {
      creates: [],
      updates: [
        { externalId: 'rec1', cells: { 'prop-title': 'x' } },
        { externalId: 'rec2', cells: { 'prop-title': 'y' } },
      ],
      deletes: [],
    };
    const { acks } = await AirtableAdapter.applyChanges(makeState(), diff);
    expect(acks).toEqual([
      { kind: 'update', externalId: 'rec1' },
      { kind: 'update', externalId: 'rec2' },
    ]);
  });

  it('emits create acks with airtable-assigned externalIds in batch order', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          records: [
            { id: 'recA', fields: {} },
            { id: 'recB', fields: {} },
          ],
        }),
        { status: 200 },
      ),
    );
    const diff: Diff = {
      creates: [
        { cairnRowId: 'c-1', cells: { 'prop-title': 'a' } },
        { cairnRowId: 'c-2', cells: { 'prop-title': 'b' } },
      ],
      updates: [],
      deletes: [],
    };
    const { acks } = await AirtableAdapter.applyChanges(makeState(), diff);
    expect(acks).toEqual([
      { kind: 'create', cairnRowId: 'c-1', externalId: 'recA' },
      { kind: 'create', cairnRowId: 'c-2', externalId: 'recB' },
    ]);
  });

  it('emits delete acks for each deleted externalId', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    const diff: Diff = {
      creates: [],
      updates: [],
      deletes: [{ externalId: 'rec1' }, { externalId: 'rec2' }],
    };
    const { acks } = await AirtableAdapter.applyChanges(makeState(), diff);
    expect(acks).toEqual([
      { kind: 'delete', externalId: 'rec1' },
      { kind: 'delete', externalId: 'rec2' },
    ]);
  });

  it('throws when PATCH returns non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 422 }));
    const diff: Diff = {
      creates: [],
      updates: [{ externalId: 'rec1', cells: { 'prop-title': 'x' } }],
      deletes: [],
    };
    await expect(AirtableAdapter.applyChanges(makeState(), diff)).rejects.toThrow(
      /airtable\.patch 422/,
    );
  });
});

describe('AirtableAdapter.subscribe', () => {
  it('registers a webhook for the base, persists MAC secret + webhook id on syncConfig, returns an unsubscribe', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'achWEBHOOK', macSecretBase64: 'bWFjLXNlY3JldA==' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const state = makeState();
    const unsubscribe = await AirtableAdapter.subscribe?.(state, () => {});
    expect(typeof unsubscribe).toBe('function');

    // First call: POST register.
    const [registerUrl, registerInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(registerUrl)).toContain('/v0/bases/appBASE/webhooks');
    expect((registerInit as RequestInit).method).toBe('POST');
    const registerBody = JSON.parse((registerInit as RequestInit).body as string) as {
      notificationUrl: string;
      specification: { options: { filters: { recordChangeScope: string } } };
    };
    expect(registerBody.notificationUrl).toContain('/api/connectors/airtable/webhook');
    expect(registerBody.notificationUrl).toContain('w=ws-1');
    expect(registerBody.notificationUrl).toContain('c=con-air-1');
    expect(registerBody.specification.options.filters.recordChangeScope).toBe('tblTABLE');

    // syncConfig.airtableWebhook captures the id + macSecret for later validation/unsubscribe.
    const cfg = state.syncConfig as Record<string, unknown> & {
      airtableWebhook?: { id: string; macSecretBase64: string };
    };
    expect(cfg.airtableWebhook?.id).toBe('achWEBHOOK');
    expect(cfg.airtableWebhook?.macSecretBase64).toBe('bWFjLXNlY3JldA==');

    // authConfig.webhookMacSecret is updated to the per-webhook secret for HMAC validation.
    expect((state.authConfig as { webhookMacSecret: string }).webhookMacSecret).toBe(
      'bWFjLXNlY3JldA==',
    );

    await unsubscribe?.();
    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        (init as RequestInit | undefined)?.method === 'DELETE' &&
        String(url).includes('webhooks/achWEBHOOK'),
    );
    expect(deleteCall).toBeTruthy();
  });

  it('subscribe unsubscribe swallows DELETE errors (webhook may already be expired)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'achWEBHOOK', macSecretBase64: 'bWFjLXNlY3JldA==' }), {
          status: 200,
        }),
      )
      .mockRejectedValueOnce(new Error('network failure'));
    const unsubscribe = await AirtableAdapter.subscribe?.(makeState(), () => {});
    await expect(unsubscribe?.()).resolves.toBeUndefined();
  });

  it('throws when webhook registration fails', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(AirtableAdapter.subscribe?.(makeState(), () => {})).rejects.toThrow(
      /airtable\.webhook\.register 403/,
    );
  });
});

describe('AirtableAdapter — round-trip', () => {
  it('fetchAll → applyChanges keeps externalId mapping intact', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [
              { id: 'rec1', fields: { Title: 'foo', Count: 1 } },
              { id: 'rec2', fields: { Title: 'bar', Count: 2 } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));

    const state = makeState();
    const rows = await AirtableAdapter.fetchAll(state);
    const updates = rows.map((r) => ({
      externalId: r.externalId,
      cells: { ...r.cells, 'prop-title': `${String(r.cells['prop-title'])}!` },
    }));
    const { acks } = await AirtableAdapter.applyChanges(state, {
      creates: [],
      updates,
      deletes: [],
    });
    expect(acks.map((a) => (a.kind === 'update' ? a.externalId : null))).toEqual(['rec1', 'rec2']);
  });
});

describe('AirtableAdapter — secret hygiene', () => {
  it('PAT round-trips through encryptAuthConfig as a sealed bytea (never plaintext)', async () => {
    const { encryptAuthConfig, decryptAuthConfig } = await import('@/lib/connectors/auth');
    const blob = encryptAuthConfig({ pat: 'pat-supersecret-XYZ', webhookMacSecret: 'mac' });
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(blob.toString('utf8').includes('pat-supersecret-XYZ')).toBe(false);
    expect(blob.toString('hex').includes('pat-supersecret-XYZ')).toBe(false);
    expect(blob.toString('base64').includes('pat-supersecret-XYZ')).toBe(false);
    const round = decryptAuthConfig(blob);
    expect(round).toEqual({ pat: 'pat-supersecret-XYZ', webhookMacSecret: 'mac' });
  });
});
