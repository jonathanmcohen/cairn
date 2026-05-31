// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/developer/connectors',
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

function renderSidebar() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <SettingsSidebar isAdmin />
    </I18nProvider>,
  );
}

describe('Developer nav exposes the chat bridge', () => {
  it('links the Slack/Discord install and the channel links under Developer', () => {
    renderSidebar();
    const install = screen.getByRole('link', { name: 'Slack & Discord install' });
    expect(install.getAttribute('href')).toBe('/admin/chat-bridge');
    const channels = screen.getByRole('link', { name: 'Channel links' });
    expect(channels.getAttribute('href')).toBe('/admin/chat-bridge/channels');
  });
});
