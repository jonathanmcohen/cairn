import { describe, expect, it } from 'vitest';
import { friendlyUserAgent } from '@/lib/security/user-agent-label';

describe('friendlyUserAgent (#192)', () => {
  it('summarizes a desktop Chrome UA', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(friendlyUserAgent(ua)).toBe('Chrome on macOS');
  });
  it('summarizes mobile Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(friendlyUserAgent(ua)).toBe('Safari on iOS');
  });
  it('returns null for empty/unparseable input', () => {
    expect(friendlyUserAgent(null)).toBeNull();
    expect(friendlyUserAgent('')).toBeNull();
    expect(friendlyUserAgent('curl/8.4.0')).toBe('curl');
  });
});
