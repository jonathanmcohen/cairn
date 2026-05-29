// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuggestionToolbar } from '@/components/editor/suggestion-toolbar';
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

const noop = () => {};

describe('<SuggestionToolbar>', () => {
  it('renders the open-count as a button that jumps to the first open suggestion (#98)', () => {
    const onJump = vi.fn();
    render(
      wrap(
        <SuggestionToolbar
          editor={null}
          active={false}
          onToggle={noop}
          openCount={3}
          onMarkInsert={noop}
          onMarkDelete={noop}
          resolvable={null}
          onAccept={noop}
          onReject={noop}
          onJumpToFirstOpen={onJump}
        />,
      ),
    );
    // The "N open" element is a button with an accessible name.
    const badge = screen.getByRole('button', {
      name: enMessages['pageActions.suggest.openCountLabel.other'].replace('{count}', '3'),
    });
    expect(badge.tagName).toBe('BUTTON');
    fireEvent.click(badge);
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('gives Mark insert / Mark delete accessible labels + icons (#101)', () => {
    render(
      wrap(
        <SuggestionToolbar
          editor={null}
          active
          onToggle={noop}
          openCount={0}
          onMarkInsert={noop}
          onMarkDelete={noop}
          resolvable={null}
          onAccept={noop}
          onReject={noop}
          onJumpToFirstOpen={noop}
        />,
      ),
    );
    const insert = screen.getByRole('button', {
      name: enMessages['pageActions.suggest.markInsert'],
    });
    const del = screen.getByRole('button', { name: enMessages['pageActions.suggest.markDelete'] });
    expect(insert.querySelector('svg')).toBeTruthy();
    expect(del.querySelector('svg')).toBeTruthy();
  });
});
