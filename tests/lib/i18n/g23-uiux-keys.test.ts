import { describe, expect, it } from 'vitest';
import arMessages from '../../../messages/ar.json' with { type: 'json' };
import enMessages from '../../../messages/en.json' with { type: 'json' };
import esMessages from '../../../messages/es.json' with { type: 'json' };

const G23_KEYS = [
  'db.sort.title',
  'db.sort.none',
  'db.sort.byProperty',
  'db.sort.asc',
  'db.sort.desc',
  'db.sort.moveUp',
  'db.sort.moveDown',
  'db.sort.remove',
  'db.sort.add',
  'db.row.expand',
  'db.row.collapse',
  'db.row.addSubItem',
  'db.row.untitled',
  'db.calc.label',
  'db.list.empty',
  'db.gallery.empty.title',
  'db.gallery.empty.guidance',
  'automation.notify.empty',
  'automation.setProperty.databases.empty',
  'automation.setProperty.properties.empty',
  'cover.unsplash.search',
  'cover.unsplash.searching',
  'cover.unsplash.placeholder',
  'cover.unsplash.empty',
  'cover.unsplash.credit',
  'cover.uploading',
  'twoFactor.busy',
  'editor.image.openFullscreen',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('G23 ui/ux polish i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of G23_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }
});
