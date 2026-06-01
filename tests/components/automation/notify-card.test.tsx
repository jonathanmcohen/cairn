// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NotifyCard } from '@/components/automation/builder/notify-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockMembers() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ members: [{ id: 'u1', name: 'Ada' }] }), { status: 200 }),
  );
}

function renderCard(config: Record<string, unknown>, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <NotifyCard config={config} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders the user picker + message field (no raw JSON textarea)', async () => {
  mockMembers();
  const { container } = renderCard({});
  await waitFor(() => expect(screen.getByText('User to notify')).toBeTruthy());
  expect(screen.getByText('Message (optional)')).toBeTruthy();
  expect(container.querySelector('textarea')).toBeNull();
});

it('emits config when a user is picked', async () => {
  mockMembers();
  const onChange = vi.fn();
  renderCard({}, onChange);
  await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy());
  fireEvent.click(screen.getByText('Ada'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
});

it('emits message text', async () => {
  mockMembers();
  const onChange = vi.fn();
  renderCard({ userId: 'u1' }, onChange);
  await waitFor(() => screen.getByText('Message (optional)'));
  fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'Hello' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ message: 'Hello' }));
});
