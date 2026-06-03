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

const baseProps = {
  editor: null,
  openCount: 0,
  onMarkInsert: noop,
  onMarkDelete: noop,
  resolvable: null,
  onAccept: noop,
  onReject: noop,
  onOpenDrawer: noop,
};

describe('<SuggestionToolbar>', () => {
  it('renders the open-count as a button that opens the suggestions drawer (#85)', () => {
    const onOpenDrawer = vi.fn();
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
          onOpenDrawer={onOpenDrawer}
        />,
      ),
    );
    const badge = screen.getByRole('button', {
      name: enMessages['pageActions.suggest.openCountLabel.other'].replace('{count}', '3'),
    });
    expect(badge.tagName).toBe('BUTTON');
    fireEvent.click(badge);
    expect(onOpenDrawer).toHaveBeenCalledTimes(1);
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
          onOpenDrawer={noop}
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

describe('<SuggestionToolbar> chip is one clickable target (#233)', () => {
  it('fires onToggle when the chip or its inner icon is clicked', () => {
    const onToggle = vi.fn();
    render(wrap(<SuggestionToolbar {...baseProps} active={false} onToggle={onToggle} />));
    const chip = screen.getByTestId('suggest-toggle-chip');
    expect(chip.getAttribute('aria-label')).toBe(enMessages['pageActions.suggest.toggleSuggest']);
    fireEvent.click(chip);
    const icon = chip.querySelector('svg');
    expect(icon).not.toBeNull();
    fireEvent.click(icon as SVGElement);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('exposes the active aria-label while suggesting', () => {
    render(wrap(<SuggestionToolbar {...baseProps} active onToggle={noop} />));
    const chip = screen.getByTestId('suggest-toggle-chip');
    expect(chip.getAttribute('aria-label')).toBe(
      enMessages['pageActions.suggest.toggleSuggesting'],
    );
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});
