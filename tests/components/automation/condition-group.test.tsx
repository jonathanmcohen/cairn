// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConditionGroup } from '@/components/automation/builder/condition-group';
import type { ConditionGroupModel, ConditionRow } from '@/lib/automation/builder';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderGroup(group: ConditionGroupModel, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConditionGroup group={group} onChange={onChange} depth={0} />
    </I18nProvider>,
  );
}

it('renders the Add condition button on an empty group', () => {
  renderGroup({ id: 'g', logic: 'and', children: [] });
  expect(screen.getByText('Add condition')).toBeTruthy();
});

it('clicking Add condition emits a one-row group', () => {
  const onChange = vi.fn();
  renderGroup({ id: 'g', logic: 'and', children: [] }, onChange);
  fireEvent.click(screen.getByText('Add condition'));
  const arg = onChange.mock.calls[0]?.[0] as ConditionGroupModel;
  expect(arg.children).toHaveLength(1);
});

it('typing a property emits it', () => {
  const onChange = vi.fn();
  renderGroup(
    { id: 'g', logic: 'and', children: [{ id: 'c1', field: '', op: 'equals', value: null }] },
    onChange,
  );
  fireEvent.change(screen.getByPlaceholderText('row.cells.status'), {
    target: { value: 'row.cells.status' },
  });
  const arg = onChange.mock.calls[0]?.[0] as ConditionGroupModel;
  const leaf = arg.children[0] as ConditionRow;
  expect(leaf.field).toBe('row.cells.status');
});

it('toggling the combinator to OR emits logic: or (with 2 rows)', () => {
  const onChange = vi.fn();
  renderGroup(
    {
      id: 'g',
      logic: 'and',
      children: [
        { id: 'c1', field: 'a', op: 'equals', value: 1 },
        { id: 'c2', field: 'b', op: 'equals', value: 2 },
      ],
    },
    onChange,
  );
  fireEvent.click(screen.getByText('OR'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ logic: 'or' }));
});
