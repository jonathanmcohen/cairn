// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

function renderSidebar(isAdmin: boolean) {
  return render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      <SettingsSidebar isAdmin={isAdmin} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('SettingsSidebar admin parent nav', () => {
  it('Admin parent link points at the real audit leaf, not the bare section', () => {
    renderSidebar(true);
    const adminLink = screen.getByRole('link', { name: en['settings.nav.admin'] });
    expect(adminLink.getAttribute('href')).toBe('/settings/admin/audit');
  });

  it('hides the Admin section entirely for non-admins', () => {
    renderSidebar(false);
    expect(screen.queryByRole('link', { name: en['settings.nav.admin'] })).toBeNull();
  });
});
