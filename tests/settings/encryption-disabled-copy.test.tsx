// @vitest-environment jsdom
/**
 * Plan E3 (#193) — encryption-off heading copy fix.
 * When E2EE is disabled, the card heading must read the "turned off in this
 * build" title (e2ee.disabledTitle), NOT the misleading enroll-action title
 * "Set up your encryption key" (e2e.enroll.title). The disabled title must
 * also appear exactly once (heading only, not duplicated in the body notice).
 * See docs/superpowers/plans/v0.9.14/plan-E-notifications-settings.md.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
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

describe('E2EEnrollCard — encryption-off heading', () => {
  it('when enabled=false the heading does NOT say "Set up your encryption key"', () => {
    wrap(<E2EEnrollCard enabled={false} />);
    const heading = screen.queryByRole('heading', {
      name: /set up your encryption key/i,
    });
    expect(heading).toBeNull();
  });

  it('when enabled=false the heading reads the disabled-build title', () => {
    wrap(<E2EEnrollCard enabled={false} />);
    // e2ee.disabledTitle = "End-to-end encryption is turned off in this build."
    const heading = screen.getByRole('heading', {
      name: /end-to-end encryption is turned off/i,
    });
    expect(heading).toBeTruthy();
  });

  it('when enabled=false the disabled title is not duplicated in the body', () => {
    wrap(<E2EEnrollCard enabled={false} />);
    const occurrences = screen.getAllByText(/end-to-end encryption is turned off/i);
    expect(occurrences).toHaveLength(1);
  });
});
