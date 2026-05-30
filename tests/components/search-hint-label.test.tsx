// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SearchHintButton } from '@/components/search-hint-button';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json' with { type: 'json' };

afterEach(cleanup);

describe('sidebar search label (#84)', () => {
  it('en label advertises the command palette, not a bare search box', () => {
    const label = (en as Record<string, string>)['searchHint.label'] ?? '';
    expect(label.toLowerCase()).toContain('palette');
    expect(label).not.toBe('Search or jump to…');
  });

  it('renders the palette label and keeps the ⌘K affordance', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <SearchHintButton />
      </I18nProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn.textContent ?? '').toMatch(/palette/i);
    expect(btn.querySelector('kbd')?.textContent).toBe('⌘K');
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
  });
});
