// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasskeysNotConfigured } from '@/components/security/passkeys-not-configured';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en" messages={getMessages('en')}>
      {node}
    </I18nProvider>
  );
}
afterEach(cleanup);

describe('PasskeysNotConfigured (#267)', () => {
  it('hides env-var names from non-admins', () => {
    render(wrap(<PasskeysNotConfigured isAdmin={false} />));
    expect(screen.getByText(/workspace administrator/)).toBeTruthy();
    expect(screen.queryByText(/CAIRN_RP_ID/)).toBeNull();
  });
  it('shows the actionable env-var detail to admins', () => {
    render(wrap(<PasskeysNotConfigured isAdmin />));
    expect(screen.getByText(/CAIRN_RP_ID and CAIRN_RP_ORIGIN/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the operations guide' })).toBeTruthy();
  });
});
