// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MintTokenDialog } from '@/components/dev-settings/mint-token-dialog';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Messages } from '@/lib/i18n/t';
import enMessages from '../../messages/en.json' with { type: 'json' };

const SCOPES = [
  'pages:read',
  'pages:write',
  'pages:destructive',
  'databases:read',
  'databases:write',
  'databases:destructive',
  'comments:read',
  'comments:write',
  'comments:destructive',
  'files:read',
  'files:write',
  'files:destructive',
  'mcp:read',
  'mcp:write',
  'mcp:destructive',
  'admin',
] as const;

function renderDialog() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Messages}>
      <MintTokenDialog onClose={vi.fn()} onMinted={vi.fn()} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('MintTokenDialog scope tooltips (#106/#277)', () => {
  it('renders a translated title tooltip on every scope checkbox row', () => {
    renderDialog();
    // "Custom scopes" disclosure: jsdom renders <details> children regardless
    // of open state, so the checkboxes are queryable without a click.
    for (const scope of SCOPES) {
      const checkbox = screen.getByRole('checkbox', { name: scope });
      const row = checkbox.closest('label');
      expect(row, `row for ${scope}`).not.toBeNull();
      const expected = (enMessages as Record<string, string>)[`devTokens.scope.${scope}.tip`];
      expect(expected, `en tip key for ${scope}`).toBeTruthy();
      expect(row?.getAttribute('title'), `title for ${scope}`).toBe(expected);
    }
  });

  it('labels each row with the literal scope id (machine identifier, untranslated)', () => {
    renderDialog();
    for (const scope of SCOPES) {
      expect(screen.getByRole('checkbox', { name: scope })).not.toBeNull();
      expect(screen.getByText(scope)).not.toBeNull();
    }
  });
});
