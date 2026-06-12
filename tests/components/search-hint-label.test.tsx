// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SearchHintButton } from '@/components/search-hint-button';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json' with { type: 'json' };

afterEach(cleanup);

describe('sidebar search label (#84)', () => {
  it('en label is the short form; the palette identity lives in the aria key (S7)', () => {
    // v0.10.2 S7 — the "(command palette)" parenthetical wrapped the pill to
    // two lines at the 240px default width; the aria string still names it.
    const label = (en as Record<string, string>)['searchHint.label'] ?? '';
    expect(label).toBe('Search or jump to…');
    const aria = (en as Record<string, string>)['searchHint.aria'] ?? '';
    expect(aria.toLowerCase()).toContain('palette');
  });

  it('renders the palette label and keeps the ⌘K affordance', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <SearchHintButton />
      </I18nProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label') ?? '').toMatch(/palette/i);
    expect(btn.querySelector('kbd')?.textContent).toBe('⌘K');
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
  });
});
