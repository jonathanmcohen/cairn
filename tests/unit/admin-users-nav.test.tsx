// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

// Render on the Members route itself so the Admin section is expanded AND the
// Identity & access group is the active group (v0.10.2 P10 grouped the admin
// children into collapsible panels that unmount when collapsed — a child link
// is only in the DOM while its group is expanded).
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/admin/users',
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
