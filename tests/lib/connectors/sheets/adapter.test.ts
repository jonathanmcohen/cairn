import { beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level stubs so individual tests can reach in and assert call args.
const stubs = {
  batchGet: vi.fn(),
  batchUpdate: vi.fn(),
  valuesAppend: vi.fn(),
  valuesClear: vi.fn(),
  filesWatch: vi.fn(),
  channelsStop: vi.fn(),
};

vi.mock('googleapis', () => {
  class OAuth2 {
    credentials: { refresh_token?: string } = {};
    setCredentials = vi.fn((c: { refresh_token?: string }) => {
      this.credentials = { ...this.credentials, ...c };
    });
    generateAuthUrl = vi.fn().mockReturnValue('https://example.com/auth');
    getToken = vi.fn().mockResolvedValue({
      tokens: { refresh_token: 'stub-refresh', access_token: 'stub-access' },
    });
  }
  return {
    google: {
      auth: { OAuth2 },
      sheets: vi.fn(() => ({
        spreadsheets: {
          values: {
            batchGet: stubs.batchGet,
            batchUpdate: stubs.batchUpdate,
            append: stubs.valuesAppend,
            clear: stubs.valuesClear,
          },
        },
      })),
      drive: vi.fn(() => ({
        files: { watch: stubs.filesWatch },
        channels: { stop: stubs.channelsStop },
      })),
    },
  };
});

import { colLetterToIndex, indexToColLetter, SheetsAdapter } from '@/lib/connectors/sheets/adapter';
import type { ConnectorState, Diff } from '@/lib/connectors/adapter';

function makeState(over: Partial<ConnectorState> = {}): ConnectorState {
  return {
    connectorId: 'con-1',
    workspaceId: 'ws-1',
    authConfig: { refresh_token: 'stub' },
    syncConfig: {
      spreadsheetId: 'sheet-1',
      sheetTitle: 'Sheet1',
      headerRow: 1,
      columnMap: { 'prop-name': 'A', 'prop-title': 'B', 'prop-count': 'C' },
      externalIdProperty: 'prop-name',
    },
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://x');
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-thirty-two-chars-min-aaaaaa');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
  vi.stubEnv('CAIRN_GOOGLE_OAUTH_CLIENT_ID', 'cid');
  vi.stubEnv('CAIRN_GOOGLE_OAUTH_CLIENT_SECRET', 'csec');
  for (const s of Object.values(stubs)) s.mockReset();
});

describe('colLetterToIndex / indexToColLetter', () => {
  it('round-trips single letters', () => {
    expect(colLetterToIndex('A')).toBe(0);
    expect(colLetterToIndex('Z')).toBe(25);
    expect(indexToColLetter(0)).toBe('A');
    expect(indexToColLetter(25)).toBe('Z');
  });
  it('round-trips double letters', () => {
    expect(colLetterToIndex('AA')).toBe(26);
    expect(colLetterToIndex('AZ')).toBe(51);
    expect(indexToColLetter(26)).toBe('AA');
    expect(indexToColLetter(51)).toBe('AZ');
  });
});

describe('SheetsAdapter.fetchAll', () => {
  it('parses batchGet rows into ExternalRow shape using the columnMap', async () => {
    stubs.batchGet.mockResolvedValue({
      data: {
        valueRanges: [
          { range: 'Sheet1!A2:C', values: [['r1', 'foo', '1'], ['r2', 'bar', '2']] },
        ],
      },
    });
    const rows = await SheetsAdapter.fetchAll(makeState());
    expect(rows).toHaveLength(2);
    expect(rows[0]?.externalId).toBe('r1');
    expect(rows[0]?.cells['prop-title']).toBe('foo');
    expect(rows[0]?.cells['prop-count']).toBe('1');
    expect(rows[1]?.externalId).toBe('r2');
  });

  it('falls back to row number when externalId cell is empty', async () => {
    stubs.batchGet.mockResolvedValue({
      data: { valueRanges: [{ range: 'Sheet1!A2:C', values: [[null, 'foo', '1']] }] },
    });
    const rows = await SheetsAdapter.fetchAll(makeState());
    expect(rows[0]?.externalId).toBe('2'); // headerRow=1 → firstDataRow=2
  });
});

describe('SheetsAdapter.applyChanges', () => {
  it('creates: appends rows + acks with the new row number as externalId', async () => {
    stubs.valuesAppend.mockResolvedValue({
      data: { updates: { updatedRange: 'Sheet1!A5:C5' } },
    });
    const diff: Diff = {
      creates: [{ cairnRowId: 'c-1', cells: { 'prop-title': 'new', 'prop-count': '7' } }],
      updates: [],
      deletes: [],
    };
    const { acks } = await SheetsAdapter.applyChanges(makeState(), diff);
    expect(stubs.valuesAppend).toHaveBeenCalledOnce();
    expect(acks).toHaveLength(1);
    expect(acks[0]).toEqual({ kind: 'create', cairnRowId: 'c-1', externalId: '5' });
  });

  it('updates: locates the row by externalId then batchUpdates the mapped range', async () => {
    stubs.batchGet.mockResolvedValue({
      data: {
        valueRanges: [{ range: 'Sheet1!A2:A', values: [['r1'], ['r2'], ['r3']] }],
      },
    });
    stubs.batchUpdate.mockResolvedValue({ data: { totalUpdatedCells: 3 } });
    const diff: Diff = {
      creates: [],
      updates: [{ externalId: 'r2', cells: { 'prop-title': 'updated', 'prop-count': '99' } }],
      deletes: [],
    };
    const { acks } = await SheetsAdapter.applyChanges(makeState(), diff);
    expect(stubs.batchGet).toHaveBeenCalledOnce();
    expect(stubs.batchUpdate).toHaveBeenCalledOnce();
    const callArgs = stubs.batchUpdate.mock.calls[0]?.[0];
    expect(callArgs.requestBody.data[0].range).toBe('Sheet1!A3:C3'); // row 3 = r2
    expect(acks).toEqual([{ kind: 'update', externalId: 'r2' }]);
  });

  it('updates: no-ops gracefully when the external row is not found', async () => {
    stubs.batchGet.mockResolvedValue({
      data: { valueRanges: [{ range: 'Sheet1!A2:A', values: [['r1']] }] },
    });
    const diff: Diff = {
      creates: [],
      updates: [{ externalId: 'missing', cells: { 'prop-title': 'x' } }],
      deletes: [],
    };
    const { acks } = await SheetsAdapter.applyChanges(makeState(), diff);
    expect(stubs.batchUpdate).not.toHaveBeenCalled();
    expect(acks).toEqual([]);
  });

  it('deletes: clears the matched row range and acks', async () => {
    stubs.batchGet.mockResolvedValue({
      data: { valueRanges: [{ range: 'Sheet1!A2:A', values: [['r1'], ['r2']] }] },
    });
    stubs.valuesClear.mockResolvedValue({ data: {} });
    const diff: Diff = {
      creates: [],
      updates: [],
      deletes: [{ externalId: 'r1' }, { externalId: 'r-missing' }],
    };
    const { acks } = await SheetsAdapter.applyChanges(makeState(), diff);
    expect(stubs.valuesClear).toHaveBeenCalledOnce();
    const clearCall = stubs.valuesClear.mock.calls[0]?.[0];
    expect(clearCall.range).toBe('Sheet1!A2:C2');
    expect(acks).toEqual([
      { kind: 'delete', externalId: 'r1' },
      { kind: 'delete', externalId: 'r-missing' },
    ]);
  });
});

describe('SheetsAdapter.subscribe', () => {
  it('registers a Drive watch and returns an unsubscribe that stops the channel', async () => {
    stubs.filesWatch.mockResolvedValue({
      data: { id: 'ch-1', resourceId: 'res-1', expiration: '99999' },
    });
    stubs.channelsStop.mockResolvedValue({ data: {} });
    const state = makeState();
    const unsubscribe = await SheetsAdapter.subscribe?.(state, () => {});
    expect(typeof unsubscribe).toBe('function');
    expect(stubs.filesWatch).toHaveBeenCalledOnce();
    const watchCall = stubs.filesWatch.mock.calls[0]?.[0];
    expect(watchCall.fileId).toBe('sheet-1');
    expect(watchCall.requestBody.token).toBe('ws-1:con-1');
    expect(watchCall.requestBody.type).toBe('web_hook');
    // Channel state persisted into sync_config in-memory:
    const cfg = state.syncConfig as Record<string, unknown> & {
      driveChannel?: { id: string; resourceId: string; token: string; expiration: number | null };
    };
    expect(cfg.driveChannel?.id).toBe('ch-1');
    expect(cfg.driveChannel?.expiration).toBe(99999);
    await unsubscribe?.();
    expect(stubs.channelsStop).toHaveBeenCalledOnce();
  });

  it('subscribe unsubscribe swallows channels.stop errors', async () => {
    stubs.filesWatch.mockResolvedValue({ data: { id: 'ch-1', resourceId: 'res-1' } });
    stubs.channelsStop.mockRejectedValue(new Error('expired'));
    const unsubscribe = await SheetsAdapter.subscribe?.(makeState(), () => {});
    await expect(unsubscribe?.()).resolves.toBeUndefined();
  });
});

describe('SheetsAdapter — round-trip', () => {
  it('fetchAll → applyChanges keeps the externalId mapping intact', async () => {
    stubs.batchGet
      .mockResolvedValueOnce({
        data: {
          valueRanges: [
            { range: 'Sheet1!A2:C', values: [['r1', 'foo', '1'], ['r2', 'bar', '2']] },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { valueRanges: [{ range: 'Sheet1!A2:A', values: [['r1'], ['r2']] }] },
      });
    stubs.batchUpdate.mockResolvedValue({ data: { totalUpdatedCells: 2 } });
    const state = makeState();
    const rows = await SheetsAdapter.fetchAll(state);
    const diff: Diff = {
      creates: [],
      updates: rows.map((r) => ({
        externalId: r.externalId,
        cells: { ...r.cells, 'prop-title': `${r.cells['prop-title']}!` },
      })),
      deletes: [],
    };
    const { acks } = await SheetsAdapter.applyChanges(state, diff);
    expect(acks.map((a) => (a.kind === 'update' ? a.externalId : null))).toEqual(['r1', 'r2']);
  });
});
