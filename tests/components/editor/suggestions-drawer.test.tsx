// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OpenSuggestion, SuggestionsDrawer } from '@/components/editor/suggestions-drawer';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

const rows: OpenSuggestion[] = [
  { id: 's1', authorName: 'Ada' },
  { id: 's2', authorName: 'Lin' },
];

describe('<SuggestionsDrawer> (#85/#145)', () => {
  it('lists open suggestions and fires accept/reject with the row id', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={rows}
          onAccept={onAccept}
          onReject={onReject}
          onView={() => {}}
        />,
      ),
    );
    expect(screen.getByText(enMessages['pageActions.suggest.drawerTitle'])).toBeTruthy();
    const accepts = screen.getAllByRole('button', {
      name: enMessages['pageActions.suggest.accept'],
    });
    expect(accepts).toHaveLength(2);
    fireEvent.click(accepts[0] as HTMLElement);
    expect(onAccept).toHaveBeenCalledWith('s1');
    const rejects = screen.getAllByRole('button', {
      name: enMessages['pageActions.suggest.reject'],
    });
    fireEvent.click(rejects[1] as HTMLElement);
    expect(onReject).toHaveBeenCalledWith('s2');
  });

  it('renders the empty state when there are no open suggestions', () => {
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[]}
          onAccept={() => {}}
          onReject={() => {}}
          onView={() => {}}
        />,
      ),
    );
    expect(screen.getByText(enMessages['pageActions.suggest.drawerEmpty'])).toBeTruthy();
  });

  it('renders an inline diff preview when a row carries one (#232)', () => {
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[
            { id: 's1', authorName: 'Ada', diff: { deleted: 'old text', inserted: 'new text' } },
          ]}
          onAccept={() => {}}
          onReject={() => {}}
          onView={() => {}}
        />,
      ),
    );
    const del = screen.getByText('old text');
    expect(del.tagName).toBe('DEL');
    const ins = screen.getByText('new text');
    expect(ins.tagName).toBe('INS');
  });

  it('omits the diff block when a row has no diff', () => {
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[{ id: 's1', authorName: 'Ada' }]}
          onAccept={() => {}}
          onReject={() => {}}
          onView={() => {}}
        />,
      ),
    );
    expect(screen.queryByText(enMessages['pageActions.suggest.diffDeletedLabel'])).toBeNull();
  });

  it('#119 clicking the card content region fires onView with the row id', () => {
    const onView = vi.fn();
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={rows}
          onAccept={() => {}}
          onReject={() => {}}
          onView={onView}
        />,
      ),
    );
    // The content region is a <button> labelled by the author line ("by Ada");
    // it is a sibling of (not wrapping) the action buttons.
    const contentBtn = screen.getByRole('button', { name: /by Ada/ });
    fireEvent.click(contentBtn);
    expect(onView).toHaveBeenCalledWith('s1');
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('#119 clicking Accept fires onAccept and NOT onView (sibling buttons)', () => {
    const onView = vi.fn();
    const onAccept = vi.fn();
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[{ id: 's1', authorName: 'Ada' }]}
          onAccept={onAccept}
          onReject={() => {}}
          onView={onView}
        />,
      ),
    );
    const acceptBtn = screen.getByRole('button', {
      name: enMessages['pageActions.suggest.accept'],
    });
    fireEvent.click(acceptBtn);
    expect(onAccept).toHaveBeenCalledWith('s1');
    expect(onView).not.toHaveBeenCalled();
  });
});
