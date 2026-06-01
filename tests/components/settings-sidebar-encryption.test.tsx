// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('next/navigation', () => ({ usePathname: () => '/settings/security' }));

afterEach(cleanup);

describe('<SettingsSidebar> Encryption child (#168)', () => {
  it('exposes an Encryption link under Security at /settings/security/encryption', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <SettingsSidebar isAdmin />
      </I18nProvider>,
    );
    const link = screen.getByRole('link', { name: enMessages['settings.nav.security.encryption'] });
    expect(link.getAttribute('href')).toBe('/settings/security/encryption');
  });
});
