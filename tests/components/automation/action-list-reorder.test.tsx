// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionList } from '@/components/automation/builder/action-list';
import type { ActionCard } from '@/lib/automation/builder';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const actions: ActionCard[] = [
  { id: 'a1', type: 'notify', config: { userId: 'u1' } },
  { id: 'a2', type: 'send_webhook', config: { webhookId: 'w1' } },
];

function renderList(onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ActionList actions={actions} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders one move-down control per non-last action', () => {
  renderList();
  expect(screen.getAllByLabelText('Move action down')).toHaveLength(1);
});

it('moving the first action down emits the swapped order', () => {
  const onChange = vi.fn();
  renderList(onChange);
  fireEvent.click(screen.getByLabelText('Move action down'));
  const next = onChange.mock.calls[0]?.[0] as ActionCard[];
  expect(next.map((a) => a.id)).toEqual(['a2', 'a1']);
});
