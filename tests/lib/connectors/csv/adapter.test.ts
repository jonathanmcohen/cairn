import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorState, Diff } from '@/lib/connectors/adapter';

let mount: string;
beforeEach(() => {
  // Stub the full env contract the adapter reads through `env()`. Vitest
  // resets module state between files (isolate: true) so the cached `env()`
  // is rebuilt per test from the stubbed process.env values.
  vi.stubEnv('DATABASE_URL', 'postgres://x');
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-thirty-two-chars-min-aaaaaa');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
  mount = mkdtempSync(join(tmpdir(), 'cairn-csv-'));
  vi.stubEnv('CAIRN_CONNECTOR_CSV_PATH', mount);
});
afterEach(() => {
  rmSync(mount, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

import { CsvAdapter } from '@/lib/connectors/csv/adapter';

type CfgOverrides = Partial<{
  relativePath: string;
  delimiter: string;
  encoding: BufferEncoding;
  columnMap: Record<string, string>;
  externalIdProperty: string;
}>;

function makeState(cfg: CfgOverrides = {}): ConnectorState {
  return {
    connectorId: 'con-csv-1',
    workspaceId: 'ws-1',
    authConfig: {} as Record<string, unknown>,
    syncConfig: {
      relativePath: 'projects.csv',
      delimiter: ',',
      encoding: 'utf8',
      columnMap: { 'prop-id': 'id', 'prop-title': 'title', 'prop-count': 'count' },
      externalIdProperty: 'prop-id',
      ...cfg,
    },
  };
}

describe('CsvAdapter', () => {
  it('fetchAll parses a basic CSV into ExternalRow shape', async () => {
    writeFileSync(join(mount, 'projects.csv'), 'id,title,count\nr1,foo,1\nr2,bar,2\n');
    const rows = await CsvAdapter.fetchAll(makeState());
    expect(rows).toHaveLength(2);
    expect(rows[0]?.externalId).toBe('r1');
    expect(rows[0]?.cells['prop-title']).toBe('foo');
    expect(rows[1]?.cells['prop-count']).toBe('2');
  });

  it('applyChanges updates existing rows in place', async () => {
    writeFileSync(join(mount, 'projects.csv'), 'id,title,count\nr1,foo,1\nr2,bar,2\n');
    const diff: Diff = {
      creates: [],
      updates: [
        {
          externalId: 'r1',
          cells: { 'prop-id': 'r1', 'prop-title': 'foo-new', 'prop-count': '99' },
        },
      ],
      deletes: [],
    };
    const { acks } = await CsvAdapter.applyChanges(makeState(), diff);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ kind: 'update', externalId: 'r1' });
    const out = readFileSync(join(mount, 'projects.csv'), 'utf8');
    expect(out).toContain('r1,foo-new,99');
    expect(out).toContain('r2,bar,2');
  });

  it('applyChanges appends fresh creates and synthesizes external ids', async () => {
    writeFileSync(join(mount, 'projects.csv'), 'id,title,count\nr1,foo,1\n');
    const diff: Diff = {
      creates: [
        {
          cairnRowId: 'cairn-row-A',
          cells: { 'prop-id': 'r2', 'prop-title': 'bar', 'prop-count': '2' },
        },
      ],
      updates: [],
      deletes: [],
    };
    const { acks } = await CsvAdapter.applyChanges(makeState(), diff);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      kind: 'create',
      cairnRowId: 'cairn-row-A',
      externalId: 'r2',
    });
    const out = readFileSync(join(mount, 'projects.csv'), 'utf8');
    expect(out).toContain('r1,foo,1');
    expect(out).toContain('r2,bar,2');
  });

  it('applyChanges drops deleted rows from the file', async () => {
    writeFileSync(join(mount, 'projects.csv'), 'id,title,count\nr1,foo,1\nr2,bar,2\n');
    const diff: Diff = {
      creates: [],
      updates: [],
      deletes: [{ externalId: 'r2' }],
    };
    const { acks } = await CsvAdapter.applyChanges(makeState(), diff);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ kind: 'delete', externalId: 'r2' });
    const out = readFileSync(join(mount, 'projects.csv'), 'utf8');
    expect(out).toContain('r1,foo,1');
    expect(out).not.toContain('r2,bar,2');
  });

  it('throws when CAIRN_CONNECTOR_CSV_PATH is unset', async () => {
    vi.stubEnv('CAIRN_CONNECTOR_CSV_PATH', '');
    await expect(CsvAdapter.fetchAll(makeState())).rejects.toThrow(
      /CSV connector mount not configured/,
    );
  });

  it('throws when the relative path escapes the mount', async () => {
    await expect(CsvAdapter.fetchAll(makeState({ relativePath: '../etc/passwd' }))).rejects.toThrow(
      /path escapes mount/,
    );
  });

  it('does not implement subscribe (poll-only)', () => {
    expect(CsvAdapter.subscribe).toBeUndefined();
  });
});
