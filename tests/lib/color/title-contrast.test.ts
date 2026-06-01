// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveTitleForeground } from '@/lib/color/title-contrast';

describe('resolveTitleForeground', () => {
  it('falls back to the dark-theme foreground when no computed value is given', () => {
    // No DOM / no override → the dark UI default (near-white).
    expect(resolveTitleForeground(undefined)).toBe('#fafafa');
  });

  it('passes through a valid #rrggbb override', () => {
    expect(resolveTitleForeground('#111827')).toBe('#111827');
  });

  it('passes through a valid #rgb override', () => {
    expect(resolveTitleForeground('#000')).toBe('#000');
  });

  it('parses an "R G B" rgb-channel string (getComputedStyle form) to hex', () => {
    expect(resolveTitleForeground('250 250 250')).toBe('#fafafa');
    expect(resolveTitleForeground('17 24 39')).toBe('#111827');
  });

  it('parses an "rgb(r, g, b)" string to hex', () => {
    expect(resolveTitleForeground('rgb(17, 24, 39)')).toBe('#111827');
  });

  it('falls back to the dark default for an unparseable value', () => {
    expect(resolveTitleForeground('not-a-color')).toBe('#fafafa');
    expect(resolveTitleForeground('')).toBe('#fafafa');
  });
});
