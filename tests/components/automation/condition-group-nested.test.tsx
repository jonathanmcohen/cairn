// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConditionGroup } from '@/components/automation/builder/condition-group';
import type { ConditionGroupModel } from '@/lib/automation/builder';
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

it('adds a nested group when Add group is clicked', () => {
  const onChange = vi.fn();
  renderGroup({ id: 'g0', logic: 'and', children: [] }, onChange);
  fireEvent.click(screen.getByText('Add group'));
  const next = onChange.mock.calls[0][0] as ConditionGroupModel;
  expect(next.children).toHaveLength(1);
  expect((next.children[0] as ConditionGroupModel).logic).toBe('and');
});

it('renders the AND/OR toggle for a group with children', () => {
  renderGroup({
    id: 'g0',
    logic: 'or',
    children: [
      { id: 'c1', field: 'a', op: 'equals', value: '1' },
      { id: 'c2', field: 'b', op: 'equals', value: '2' },
    ],
  });
  const or = screen.getByRole('button', { name: 'OR' });
  expect(or.getAttribute('aria-pressed')).toBe('true');
});

it('hides Add group at the depth cap', () => {
  renderGroup({ id: 'g', logic: 'and', children: [] }, vi.fn());
  // depth=5 is the cap; render directly at the cap and assert the button is gone.
  cleanup();
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConditionGroup
        group={{ id: 'g', logic: 'and', children: [] }}
        onChange={vi.fn()}
        depth={5}
      />
    </I18nProvider>,
  );
  expect(screen.queryByText('Add group')).toBeNull();
});
