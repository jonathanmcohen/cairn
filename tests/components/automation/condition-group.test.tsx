// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConditionGroup } from '@/components/automation/builder/condition-group';
import type { ConditionGroup as ConditionGroupModel } from '@/lib/automation/builder';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderGroup(group: ConditionGroupModel, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConditionGroup group={group} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders the Add condition button on an empty group', () => {
  renderGroup({ combinator: 'and', rows: [] });
  expect(screen.getByText('Add condition')).toBeTruthy();
});

it('clicking Add condition emits a one-row group', () => {
  const onChange = vi.fn();
  renderGroup({ combinator: 'and', rows: [] }, onChange);
  fireEvent.click(screen.getByText('Add condition'));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ rows: expect.arrayContaining([expect.anything()]) }),
  );
  const arg = onChange.mock.calls[0]?.[0] as ConditionGroupModel;
  expect(arg.rows).toHaveLength(1);
});

it('typing a property emits it', () => {
  const onChange = vi.fn();
  renderGroup(
    { combinator: 'and', rows: [{ id: 'c1', property: '', operator: 'equals', value: null }] },
    onChange,
  );
  fireEvent.change(screen.getByPlaceholderText('row.cells.status'), {
    target: { value: 'row.cells.status' },
  });
  const arg = onChange.mock.calls[0]?.[0] as ConditionGroupModel;
  expect(arg.rows[0]?.property).toBe('row.cells.status');
});

it('toggling the combinator to OR emits combinator: or (with 2 rows)', () => {
  const onChange = vi.fn();
  renderGroup(
    {
      combinator: 'and',
      rows: [
        { id: 'c1', property: 'a', operator: 'equals', value: 1 },
        { id: 'c2', property: 'b', operator: 'equals', value: 2 },
      ],
    },
    onChange,
  );
  fireEvent.click(screen.getByText('OR'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ combinator: 'or' }));
});
