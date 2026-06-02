// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

// Render on an admin route so the Admin section is expanded and its children
// are in the DOM (the section renders children only when active).
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/admin/audit',
}));

describe('Admin > Members nav child points at the dedicated users page', () => {
  it('uses /settings/admin/users, not the workspace members cross-link', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <SettingsSidebar isAdmin />
      </I18nProvider>,
    );
    const members = screen.getByRole('link', { name: en['settings.nav.admin.members'] });
    expect(members.getAttribute('href')).toBe('/settings/admin/users');
  });
});
