import { describe, expect, it } from 'vitest';
import { resolveLocale } from '@/lib/i18n/resolve';

describe('resolveLocale', () => {
  it('prefers a valid cookie value', () => {
    expect(resolveLocale('ar', 'en-US,en;q=0.9')).toBe('ar');
  });

  it('ignores an unsupported cookie value and uses Accept-Language', () => {
    expect(resolveLocale('xx', 'ar;q=0.8,en;q=0.5')).toBe('ar');
  });

  it('parses Accept-Language and picks the highest-q supported language', () => {
    expect(resolveLocale(null, 'fr;q=0.9,ar;q=0.8,en;q=0.5')).toBe('ar');
  });

  it('ignores region subtags when matching base language', () => {
    expect(resolveLocale(null, 'ar-EG,en-US;q=0.5')).toBe('ar');
  });

  it('falls back to en when nothing matches', () => {
    expect(resolveLocale(null, 'fr,de;q=0.5')).toBe('en');
  });

  it('returns the default locale when both inputs are null', () => {
    expect(resolveLocale(null, null)).toBe('en');
  });
});
