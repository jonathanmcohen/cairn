// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiKeysManager } from '@/components/settings/api-keys-manager';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

describe('<ApiKeysManager> "Create key" button (#34)', () => {
  // #34 (reopened): the button must stay a 44px primary button. The visible
  // defect (a near-white pill in dark mode) was a token bug — the default
  // accent never bound --primary — fixed in globals.css. This guards the
  // variant so a future refactor can't silently downgrade it.
  it('renders "Create key" as a 44px primary button', () => {
    // v0.9.9 Plan I (#203) — ApiKeysManager now consumes useT() for its empty
    // state, so it must render inside an I18nProvider.
    render(
      <I18nProvider locale="en" messages={getMessages('en')}>
        <ApiKeysManager initialKeys={[]} />
      </I18nProvider>,
    );
    const btn = screen.getByRole('button', { name: /create key/i });
    expect(btn.className).toMatch(/bg-primary/);
    expect(btn.className).toMatch(/min-h-11/);
  });
});
