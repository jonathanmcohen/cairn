// @vitest-environment jsdom
/**
 * Plan E2 (#89) — passkeys admin/user copy split (regression; shipped).
 * Asserts non-admins never see WebAuthn env var names or the ops docs link,
 * while admins do. See docs/superpowers/plans/v0.9.14/plan-E-notifications-settings.md.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasskeysNotConfigured } from '@/components/security/passkeys-not-configured';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

function wrap(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('PasskeysNotConfigured', () => {
  it('non-admin: shows generic user message, no env var names', () => {
    wrap(<PasskeysNotConfigured isAdmin={false} />);
    const body = screen.getByText(/ask your workspace administrator/i);
    expect(body).toBeTruthy();
    // Env var names must not appear for non-admins.
    expect(screen.queryByText(/CAIRN_RP_ID/)).toBeNull();
    expect(screen.queryByText(/CAIRN_RP_ORIGIN/)).toBeNull();
  });

  it('admin: shows env var setup instructions', () => {
    wrap(<PasskeysNotConfigured isAdmin={true} />);
    expect(screen.getByText(/CAIRN_RP_ID/)).toBeTruthy();
    expect(screen.getByText(/CAIRN_RP_ORIGIN/)).toBeTruthy();
  });

  it('admin: renders docs link', () => {
    wrap(<PasskeysNotConfigured isAdmin={true} />);
    expect(screen.getByRole('link', { name: /operations guide/i })).toBeTruthy();
  });

  it('non-admin: no docs link', () => {
    wrap(<PasskeysNotConfigured isAdmin={false} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
