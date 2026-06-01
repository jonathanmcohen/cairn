import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

const KEYS = [
  'pages.status.label',
  'pages.status.draft',
  'pages.status.review',
  'pages.status.published',
  'pages.status.archived',
  'pages.status.change',
  'pages.status.changeError',
];

describe('G16 status i18n keys', () => {
  for (const locale of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as const) {
    const [name, msgs] = locale;
    for (const key of KEYS) {
      it(`${name} has ${key}`, () => {
        expect((msgs as Record<string, string>)[key]).toBeTruthy();
      });
    }
  }
});
