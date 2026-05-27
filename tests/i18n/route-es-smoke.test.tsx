// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };
import { I18nProvider, useT } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
});

/**
 * Minimal consumer that renders three i18n keys; if the bundle swaps, the
 * rendered text should switch locales without any other code change.
 */
function Probe() {
  const t = useT();
  return (
    <>
      <p data-testid="title">{t('app.title')}</p>
      <p data-testid="shortcuts-title">{t('shortcuts.title')}</p>
      <p data-testid="locale-label">{t('locale.label')}</p>
    </>
  );
}

describe('locale wiring smoke', () => {
  it.each([
    ['en', enMessages, 'Keyboard shortcuts', 'Language'],
    ['es', esMessages, 'Atajos de teclado', 'Idioma'],
  ] as const)(
    'renders %s bundle through <I18nProvider>',
    (locale, messages, shortcutsTitle, label) => {
      render(
        <I18nProvider locale={locale} messages={messages as Record<string, string>}>
          <Probe />
        </I18nProvider>,
      );
      expect(screen.getByTestId('title').textContent).toBe('Cairn');
      expect(screen.getByTestId('shortcuts-title').textContent).toBe(shortcutsTitle);
      expect(screen.getByTestId('locale-label').textContent).toBe(label);
    },
  );
});
