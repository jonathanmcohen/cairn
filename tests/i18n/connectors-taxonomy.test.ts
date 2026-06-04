import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

type Catalogue = Record<string, string>;
const catalogues: Record<string, Catalogue> = {
  en: en as Catalogue,
  es: es as Catalogue,
  ar: ar as Catalogue,
};

describe('connectors page taxonomy (#196 / #17)', () => {
  it('renames the DB-sync heading away from the word "connectors"', () => {
    expect((en as Catalogue)['connectorsDb.heading']).toBe('Database sync');
    expect((es as Catalogue)['connectorsDb.heading']).toBe('Sincronización de bases de datos');
    expect((ar as Catalogue)['connectorsDb.heading']).toBe('مزامنة قاعدة البيانات');
  });

  it('renames the chat-bridge heading from the generic "Connectors"', () => {
    expect((en as Catalogue)['connectors.title']).toBe('Chat bridge');
    expect((es as Catalogue)['connectors.title']).toBe('Puente de chat');
    expect((ar as Catalogue)['connectors.title']).toBe('جسر الدردشة');
  });

  it('gives the two on-page section headings distinct values in every locale', () => {
    for (const [locale, cat] of Object.entries(catalogues)) {
      expect(cat['connectorsDb.heading'], `${locale} DB heading present`).toBeTruthy();
      expect(cat['connectors.title'], `${locale} chat heading present`).toBeTruthy();
      expect(
        cat['connectorsDb.heading'],
        `${locale} headings must differ so the page has no duplicate "connectors" section`,
      ).not.toBe(cat['connectors.title']);
    }
  });

  it('uses the unified verb "New" for both section create buttons (#197)', () => {
    expect((en as Catalogue)['connectorsDb.create']).toBe('New database sync');
    expect((en as Catalogue)['connectors.add']).toBe('New chat bridge');
    expect((es as Catalogue)['connectorsDb.create']).toBe('Nueva sincronización de bases de datos');
    expect((es as Catalogue)['connectors.add']).toBe('Nuevo puente de chat');
    expect((ar as Catalogue)['connectorsDb.create']).toBe('مزامنة قاعدة بيانات جديدة');
    expect((ar as Catalogue)['connectors.add']).toBe('جسر دردشة جديد');

    // English buttons share the same leading verb token.
    for (const key of ['connectorsDb.create', 'connectors.add'] as const) {
      const [verb] = ((en as Catalogue)[key] ?? '').split(' ');
      expect(verb).toBe('New');
    }
  });
});
