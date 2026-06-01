// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StudyLink } from '@/components/sidebar/study-link';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

afterEach(cleanup);

describe('<StudyLink>', () => {
  it('always renders a localized link to the study session', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <StudyLink />
      </I18nProvider>,
    );
    const link = screen.getByRole('link', { name: 'Study flashcards' });
    expect(link.getAttribute('href')).toBe('/flashcards/study');
  });
});
