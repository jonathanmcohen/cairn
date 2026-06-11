import { describe, expect, it } from 'vitest';
import {
  buildBackupCommand,
  isValidCronSpec,
  nextRunAtFromCronSpec,
  parseBackupCommand,
} from '@/lib/backups/schedule';

// v0.10.0 C3 — pure pieces of the schedule API. The command builder is the
// audit-trap pin: a stored backup command WITHOUT --out throws on every cron
// tick, so the builder must always emit it.

describe('isValidCronSpec', () => {
  it('accepts standard 5-field specs (the same parser the scheduler runs)', () => {
    expect(isValidCronSpec('0 3 * * *')).toBe(true);
    expect(isValidCronSpec('0 3 * * 0')).toBe(true);
    expect(isValidCronSpec('*/5 * * * *')).toBe(true);
    expect(isValidCronSpec('15 1 * * 1-5')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidCronSpec('')).toBe(false);
    expect(isValidCronSpec('not a cron')).toBe(false);
    expect(isValidCronSpec('99 99 * * *')).toBe(false);
    expect(isValidCronSpec('* * * *; DROP TABLE pages')).toBe(false);
  });
});

describe('nextRunAtFromCronSpec', () => {
  it('returns a future date', () => {
    expect(nextRunAtFromCronSpec('0 3 * * *').getTime()).toBeGreaterThan(Date.now());
  });
});

describe('buildBackupCommand', () => {
  it('ALWAYS contains --out and --trigger scheduled', () => {
    const cmd = buildBackupCommand({ outDir: '/data/backups', target: 'local' });
    expect(cmd).toContain('--out /data/backups');
    expect(cmd).toContain('--trigger scheduled');
    expect(cmd.startsWith('backup ')).toBe(true);
  });

  it('appends retention-days, keep, and s3 target when given', () => {
    const cmd = buildBackupCommand({
      outDir: '/data/backups',
      target: 's3',
      retentionDays: 14,
      keep: 5,
    });
    expect(cmd).toBe(
      'backup --out /data/backups --trigger scheduled --retention-days 14 --keep 5 --target s3',
    );
  });

  it('omits --target for local (the CLI default)', () => {
    expect(buildBackupCommand({ outDir: '/b', target: 'local' })).not.toContain('--target');
  });

  it('rejects an outDir the whitespace-splitting scheduler would shear apart', () => {
    expect(() => buildBackupCommand({ outDir: '/data/my backups', target: 'local' })).toThrow(
      /whitespace/,
    );
    expect(() => buildBackupCommand({ outDir: '', target: 'local' })).toThrow(/whitespace/);
  });
});

describe('parseBackupCommand', () => {
  it('round-trips what buildBackupCommand produced', () => {
    const cmd = buildBackupCommand({
      outDir: '/data/backups',
      target: 's3',
      retentionDays: 30,
      keep: 7,
    });
    expect(parseBackupCommand(cmd)).toEqual({ target: 's3', retentionDays: 30, keep: 7 });
  });

  it('defaults to local target with no pruning flags', () => {
    expect(parseBackupCommand('backup --out /b --trigger scheduled')).toEqual({
      target: 'local',
      retentionDays: undefined,
      keep: undefined,
    });
  });
});
