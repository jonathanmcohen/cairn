import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/server/cli-internal';

describe('parseArgs (P21 additions)', () => {
  it('parses backup --retention-days and --target', () => {
    const a = parseArgs(['backup', '--out', '/b', '--retention-days', '14', '--target', 's3']);
    expect(a).toMatchObject({ command: 'backup', out: '/b', retentionDays: 14, target: 's3' });
  });
  it('defaults target to local and retentionDays to undefined', () => {
    const a = parseArgs(['backup', '--out', '/b']);
    expect(a).toMatchObject({ command: 'backup', target: 'local' });
    expect(a.retentionDays).toBeUndefined();
  });
  it('rejects an invalid --target', () => {
    expect(() => parseArgs(['backup', '--out', '/b', '--target', 'ftp'])).toThrow();
  });
  it('rejects a non-numeric --retention-days', () => {
    expect(() => parseArgs(['backup', '--out', '/b', '--retention-days', 'soon'])).toThrow();
  });
  it('parses export --workspace --out', () => {
    const a = parseArgs(['export', '--workspace', 'w1', '--out', '/e']);
    expect(a).toMatchObject({ command: 'export', workspace: 'w1', out: '/e' });
  });
  it('parses import --source --file --workspace', () => {
    const a = parseArgs(['import', '--source', 'notion', '--file', '/n.zip', '--workspace', 'w1']);
    expect(a).toMatchObject({
      command: 'import',
      source: 'notion',
      file: '/n.zip',
      workspace: 'w1',
    });
  });
  it('rejects an unknown --source', () => {
    expect(() =>
      parseArgs(['import', '--source', 'evernote', '--file', '/x', '--workspace', 'w']),
    ).toThrow();
  });
  it('parses reconcile (all) and reconcile --workspace', () => {
    expect(parseArgs(['reconcile'])).toMatchObject({ command: 'reconcile' });
    expect(parseArgs(['reconcile', '--workspace', 'w1'])).toMatchObject({
      command: 'reconcile',
      workspace: 'w1',
    });
  });
  it('parses reminders:scan with no flags', () => {
    expect(parseArgs(['reminders:scan'])).toMatchObject({ command: 'reminders:scan' });
  });
  it('parses reindex-embeddings (no flags)', () => {
    expect(parseArgs(['reindex-embeddings'])).toMatchObject({ command: 'reindex-embeddings' });
  });
  it('parses reindex-embeddings --workspace', () => {
    expect(parseArgs(['reindex-embeddings', '--workspace', 'w1'])).toMatchObject({
      command: 'reindex-embeddings',
      workspace: 'w1',
    });
  });
  it('parses reindex-embeddings --batch-size', () => {
    expect(parseArgs(['reindex-embeddings', '--batch-size', '32'])).toMatchObject({
      command: 'reindex-embeddings',
      batchSize: 32,
    });
  });
  it('rejects a non-positive --batch-size', () => {
    expect(() => parseArgs(['reindex-embeddings', '--batch-size', '0'])).toThrow();
    expect(() => parseArgs(['reindex-embeddings', '--batch-size', 'soon'])).toThrow();
  });
  it('parses restore --from-s3 <key>', () => {
    const a = parseArgs(['restore', '--from-s3', 'backups/x.zip', '--force']);
    expect(a).toMatchObject({ command: 'restore', fromS3: 'backups/x.zip', force: true });
    expect(a.in).toBeUndefined();
  });
  it('requires either --in or --from-s3 for restore', () => {
    expect(() => parseArgs(['restore', '--force'])).toThrow();
  });
  it('rejects both --in and --from-s3 simultaneously', () => {
    expect(() =>
      parseArgs(['restore', '--in', '/tmp/x.zip', '--from-s3', 'backups/x.zip']),
    ).toThrow();
  });
});
