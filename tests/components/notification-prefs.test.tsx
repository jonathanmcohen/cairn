// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationPrefs } from '@/components/settings/notification-prefs';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

const PREFS = [
  { notificationType: 'mention', emailEnabled: false, digestOnly: false },
  { notificationType: 'comment_reply', emailEnabled: false, digestOnly: false },
];

function mockPrefs(emailEnabled: boolean) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ prefs: PREFS, emailEnabled }), { status: 200 }),
  );
}

describe('<NotificationPrefs> #72 type rows', () => {
  it('renders a row for each emailable type using i18n labels', async () => {
    mockPrefs(true);
    renderWithI18n(<NotificationPrefs />);
    await waitFor(() => expect(screen.getByText('Mentions')).toBeTruthy());
    expect(screen.getByText('Comment replies')).toBeTruthy();
  });
});
