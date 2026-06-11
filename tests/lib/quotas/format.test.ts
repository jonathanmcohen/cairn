import { describe, expect, it } from 'vitest';
import { formatBytes } from '@/lib/quotas/format';

// v0.10.0 D6 — shared byte formatter (upload 413 error + storage meter).
// Contract: < 1 KB renders as integer bytes; >= 1 KB renders with exactly one
// decimal in the largest unit >= 1; junk clamps to "0 B".
describe('formatBytes', () => {
  it('formats zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('clamps negative and non-finite input to zero', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('renders sub-KB values as integer bytes', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('renders KB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('renders exact MB values with the .0 decimal kept', () => {
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('renders fractional MB rounded to one decimal', () => {
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatBytes(1.26 * 1024 * 1024)).toBe('1.3 MB');
  });

  it('renders GB and caps at TB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(5 * 1024 ** 4)).toBe('5.0 TB');
    // Beyond TB stays in TB (no PB unit) rather than inventing units.
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048.0 TB');
  });
});
