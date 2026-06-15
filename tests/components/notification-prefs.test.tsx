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
  { notificationType: 'page_approval', emailEnabled: false, digestOnly: false },
  { notificationType: 'page_status', emailEnabled: false, digestOnly: false },
  { notificationType: 'page_lock', emailEnabled: false, digestOnly: false },
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
    // v0.9.9 Plan I (#195) — the three new emailable event types.
    expect(screen.getByText('Approval decisions')).toBeTruthy();
    expect(screen.getByText('Page status changes')).toBeTruthy();
    expect(screen.getByText('Page locks')).toBeTruthy();
  });
});

describe('<NotificationPrefs> #73/#74 SMTP-off handling', () => {
  it('disables email-bearing buttons with a non-color reason and shows a neutral amber banner', async () => {
    mockPrefs(false);
    const { container } = renderWithI18n(<NotificationPrefs />);

    // The amber/info banner (NOT red/destructive) is present.
    const banner = await screen.findByRole('status');
    expect(banner.className).toContain('bg-amber-50');
    expect(banner.className).toContain('text-amber-900');
    expect(banner.className).not.toContain('bg-destructive');
    expect(banner.className).not.toContain('text-destructive');

    // Email + Daily digest buttons are disabled with a textual reason.
    const emailBtns = screen.getAllByRole('button', { name: 'Email' });
    const digestBtns = screen.getAllByRole('button', { name: 'Daily digest' });
    for (const b of [...emailBtns, ...digestBtns]) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.getAttribute('aria-describedby')).toBe(banner.id);
    }
    // In-app only stays enabled (no email).
    for (const b of screen.getAllByRole('button', { name: 'In-app only' })) {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
    expect(container).toBeTruthy();
  });

  it('shows a configure-email CTA link inside the disabled banner (#194 / CFG-1)', async () => {
    mockPrefs(false);
    renderWithI18n(<NotificationPrefs />);
    // v0.10.3 CFG-1 — the banner now links to the in-app email-config settings
    // page (where SMTP is configured) instead of the external docs page.
    const link = await screen.findByRole('link', { name: 'Configure email' });
    expect(link.getAttribute('href')).toBe('/settings/admin/email');
  });

  it('does not show the configure-email CTA link when SMTP is configured (#194)', async () => {
    mockPrefs(true);
    renderWithI18n(<NotificationPrefs />);
    await waitFor(() => expect(screen.getByText('Mentions')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Configure email' })).toBeNull();
  });

  it('enables all buttons and hides the banner when SMTP is configured', async () => {
    mockPrefs(true);
    renderWithI18n(<NotificationPrefs />);
    await waitFor(() => expect(screen.getByText('Mentions')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
    for (const b of screen.getAllByRole('button', { name: 'Email' })) {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
  });
});
