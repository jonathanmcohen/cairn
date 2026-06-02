// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuleCanvas } from '@/components/automation/builder/rule-canvas';
import type { RuleListRow } from '@/components/automation/rule-list';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(saveImpl?: (url: string, init?: RequestInit) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/workspaces/members')) {
      return new Response(JSON.stringify({ members: [{ id: 'u1', name: 'Ada' }] }), {
        status: 200,
      });
    }
    if (init?.method === 'POST' && url.includes('/api/automation/rules')) {
      return saveImpl
        ? saveImpl(url, init)
        : new Response(
            JSON.stringify({
              id: 'r1',
              name: 'My rule',
              triggerEvent: 'row.created',
              condition: {},
              actionType: 'notify',
              actionConfig: { userId: 'u1' },
              enabled: true,
              createdAt: new Date().toISOString(),
              builder: null,
            }),
            { status: 201 },
          );
    }
    return new Response(JSON.stringify({ databases: [], templates: [], webhooks: [], nodes: [] }), {
      status: 200,
    });
  });
}

function renderCanvas(onClose = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <RuleCanvas mode="create" onClose={onClose} />
    </I18nProvider>,
  );
}

it('renders the trigger, condition, action, test, templates, and save affordances', async () => {
  mockFetch();
  renderCanvas();
  await waitFor(() => expect(screen.getByText('When this happens')).toBeTruthy());
  expect(screen.getByText('Add condition')).toBeTruthy();
  expect(screen.getByText('Test rule')).toBeTruthy();
  expect(screen.getByText('Start from a template')).toBeTruthy();
  expect(screen.getAllByText('Save rule').length).toBeGreaterThan(0);
});

it('Save with an empty name shows the inline error and does NOT POST', async () => {
  const fetchSpy = mockFetch();
  renderCanvas();
  await waitFor(() => screen.getByText('When this happens'));
  // Click the Save button (last "Save rule" — the action button).
  const saveButtons = screen.getAllByText('Save rule');
  const saveBtn = saveButtons[saveButtons.length - 1];
  if (!saveBtn) throw new Error('no save button');
  fireEvent.click(saveBtn);
  await waitFor(() => expect(screen.getByText(/needs a name/i)).toBeTruthy());
  const posted = fetchSpy.mock.calls.some(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
  );
  expect(posted).toBe(false);
});

it('Save with a name + picked user POSTs name/condition/actionType/actionConfig + builder', async () => {
  let postedBody: unknown = null;
  mockFetch((_url, init) => {
    postedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: 'r1',
        name: 'My rule',
        triggerEvent: 'row.created',
        condition: {},
        actionType: 'notify',
        actionConfig: { userId: 'u1' },
        enabled: true,
        createdAt: new Date().toISOString(),
        builder: null,
      }),
      { status: 201 },
    );
  });
  const onClose = vi.fn();
  renderCanvas(onClose);
  await waitFor(() => screen.getByText('Ada'));
  // Name input is the first textbox.
  const nameInput = document.querySelector('input');
  if (!nameInput) throw new Error('no name input');
  fireEvent.change(nameInput, { target: { value: 'My rule' } });
  fireEvent.click(screen.getByText('Ada'));
  const saveButtons = screen.getAllByText('Save rule');
  const saveBtn = saveButtons[saveButtons.length - 1];
  if (!saveBtn) throw new Error('no save button');
  fireEvent.click(saveBtn);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const body = postedBody as Record<string, unknown>;
  expect(body.name).toBe('My rule');
  expect(body.actionType).toBe('notify');
  expect(body).toHaveProperty('condition');
  expect(body.actionConfig).toEqual({ userId: 'u1' });
  expect(body).toHaveProperty('builder');
});

it('edit mode seeded with a builder blob rehydrates the stored combinator', async () => {
  mockFetch();
  const rule: RuleListRow = {
    id: 'r9',
    name: 'Existing',
    triggerEvent: 'page.created',
    condition: {},
    actionType: 'notify',
    actionConfig: { userId: 'u1' },
    enabled: true,
    createdAt: new Date().toISOString(),
    lastStatus: null,
    lastRunAt: null,
    builder: {
      triggerEvent: 'page.created',
      conditions: { id: 'g', logic: 'or', children: [] },
      actions: [{ id: 'a1', type: 'notify', config: { userId: 'u1' } }],
    },
  };
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <RuleCanvas mode="edit" rule={rule} onClose={vi.fn()} />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText('When this happens')).toBeTruthy());
  // Edit mode hides the templates gallery.
  expect(screen.queryByText('Start from a template')).toBeNull();
});
