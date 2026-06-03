// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitcher } from '@/components/databases/view-switcher';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const needHint = enMessages['database.view.needProperty'];

describe('add-view availability hint (#264)', () => {
  it('shows the needProperty hint + disabled Calendar/Timeline/Board when no date/select props exist', async () => {
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'v1', type: 'table', name: 'Table' }]}
        activeId="v1"
        dateProperties={[]}
        selectProperties={[]}
        onChange={() => {}}
        onViewsChanged={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: /add view/i }));
    const calendar = await screen.findByRole('option', { name: /calendar/i });
    expect(calendar.getAttribute('aria-disabled')).toBe('true');
    const board = screen.getByRole('option', { name: /board/i });
    expect(board.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(needHint)).toBeTruthy();
  });

  it('enables Calendar/Timeline when a date property exists and hides the hint', async () => {
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'v1', type: 'table', name: 'Table' }]}
        activeId="v1"
        dateProperties={[{ id: 'd1', name: 'Due' }]}
        selectProperties={[]}
        onChange={() => {}}
        onViewsChanged={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: /add view/i }));
    const calendar = await screen.findByRole('option', { name: /calendar/i });
    expect(calendar.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByText(needHint)).toBeNull();
  });
});
