// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TemplatesGallery } from '@/components/automation/builder/templates-gallery';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderGallery(onPick = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <TemplatesGallery onPick={onPick} />
    </I18nProvider>,
  );
}

it('shows a search box and all templates by default', () => {
  renderGallery();
  expect(screen.getByLabelText('Search templates')).toBeTruthy();
  expect(screen.getByText('Notify on high-priority row')).toBeTruthy();
  expect(screen.getByText('Auto-assign on @mention')).toBeTruthy();
  expect(screen.getByText('Archive when status = Done')).toBeTruthy();
});

it('filters by name', () => {
  renderGallery();
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'archive' } });
  expect(screen.getByText('Archive when status = Done')).toBeTruthy();
  expect(screen.queryByText('Notify on high-priority row')).toBeNull();
});

it('shows an empty message when nothing matches', () => {
  renderGallery();
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'zzzzz' } });
  expect(screen.getByText('No templates match your search.')).toBeTruthy();
});
