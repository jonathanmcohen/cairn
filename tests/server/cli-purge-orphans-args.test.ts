import { describe, expect, it } from 'vitest';
import { parseArgs } from '@/server/cli-internal';

describe('parseArgs pages:purge-orphans', () => {
  it('parses the bare command with no flags (default older-than applied by main)', () => {
    const args = parseArgs(['pages:purge-orphans']);
    expect(args.command).toBe('pages:purge-orphans');
    expect(args.olderThanDays).toBeUndefined();
    expect(args.dryRun).toBe(false);
  });

  it('parses --older-than and --dry-run', () => {
    const args = parseArgs(['pages:purge-orphans', '--older-than', '7', '--dry-run']);
    expect(args.olderThanDays).toBe(7);
    expect(args.dryRun).toBe(true);
  });

  it('rejects a non-positive --older-than', () => {
    expect(() => parseArgs(['pages:purge-orphans', '--older-than', '0'])).toThrow(
      /--older-than requires a positive integer/,
    );
  });
});
