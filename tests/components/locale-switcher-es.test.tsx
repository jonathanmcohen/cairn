// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

afterEach(() => {
  cleanup();
});

describe('<LocaleSwitcher>', () => {
  it('renders the themed Select trigger labelled with the locale label', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // The switcher renders a themed (radix) Select; its trigger has role combobox.
    const trigger = screen.getByRole('combobox', { name: /language/i });
    expect(trigger).toBeTruthy();
    // The active locale (en) label should be shown on the trigger.
    expect(trigger.textContent).toMatch(/english/i);
  });

  it('renders Spanish trigger label when locale=es is active', () => {
    render(
      <I18nProvider locale="es" messages={esMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // Under locale=es the label text should be the Spanish translation 'Idioma'.
    expect(screen.getByText('Idioma')).toBeTruthy();
    // And the trigger should show the active Spanish-locale label 'Español'.
    const trigger = screen.getByRole('combobox', { name: 'Idioma' });
    expect(trigger.textContent).toMatch(/español/i);
  });
});
