// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };
import { LocaleSwitcher } from '@/components/locale-switcher';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
});

describe('<LocaleSwitcher>', () => {
  it('lists es as a selectable option (rendered via LOCALES iteration)', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // The switcher renders a native <select> with one <option> per LOCALES entry.
    // Look for the Spanish-label option using its English-locale label.
    const option = screen.getByRole('option', { name: /spanish/i }) as HTMLOptionElement;
    expect(option).toBeTruthy();
    expect(option.value).toBe('es');
  });

  it('renders Spanish trigger label when locale=es is active', () => {
    render(
      <I18nProvider locale="es" messages={esMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // Under locale=es the label text should be the Spanish translation 'Idioma'.
    expect(screen.getByText('Idioma')).toBeTruthy();
    // And the Spanish-locale option label should be 'Español'.
    const spanishOption = screen.getByRole('option', { name: /español/i }) as HTMLOptionElement;
    expect(spanishOption.value).toBe('es');
  });
});
