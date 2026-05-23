import { describe, expect, it } from 'vitest';
import { createT } from '@/lib/i18n/t';

describe('createT', () => {
  it('returns the message for a flat-key lookup', () => {
    const t = createT('en', { 'app.title': 'Cairn' });
    expect(t('app.title')).toBe('Cairn');
  });

  it('interpolates {name} placeholders', () => {
    const t = createT('en', { 'greet.hello': 'Hello, {name}!' });
    expect(t('greet.hello', { name: 'Ada' })).toBe('Hello, Ada!');
  });

  it('falls back to the key itself when no message exists', () => {
    const t = createT('en', {});
    expect(t('missing.key')).toBe('missing.key');
  });

  it('selects the plural form via count (one vs other)', () => {
    const t = createT('en', {
      'items.one': '{count} item',
      'items.other': '{count} items',
    });
    expect(t('items', { count: 1 })).toBe('1 item');
    expect(t('items', { count: 3 })).toBe('3 items');
  });

  it('falls back to the bare key when the plural categories are missing', () => {
    const t = createT('en', { items: '{count} items' });
    expect(t('items', { count: 5 })).toBe('5 items');
  });

  it('leaves unmatched placeholders intact', () => {
    const t = createT('en', { 'greet.hello': 'Hello, {name}!' });
    expect(t('greet.hello')).toBe('Hello, {name}!');
  });
});
