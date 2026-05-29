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

  it('keeps an accessible Language name on the trigger regardless of viewport', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // aria-label is always present (it is the accessible name when the visible
    // label/text is hidden below `sm`). This must NOT depend on the breakpoint.
    const trigger = screen.getByRole('combobox', { name: /language/i });
    expect(trigger.getAttribute('aria-label')).toMatch(/language/i);
  });

  it('renders a decorative globe icon that is hidden from assistive tech', () => {
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // The collapsed (narrow) affordance is a Globe icon; it must be aria-hidden
    // so SR users hear only the single "Language" accessible name.
    const svg = container.querySelector('svg[aria-hidden="true"].lucide-globe');
    expect(svg).toBeTruthy();
  });

  it('marks the standalone label as responsive-hidden (sr-safe) below sm', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <LocaleSwitcher />
      </I18nProvider>,
    );
    // The visible "Language" span is present in the DOM but carries the
    // hidden-below-sm utility, so wide viewports still show it.
    const label = screen.getByText(/^Language$/);
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('sm:inline');
  });
});
