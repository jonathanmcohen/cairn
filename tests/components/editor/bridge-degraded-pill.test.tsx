// @vitest-environment jsdom
// v0.10.2 P12 — degraded-collab pill. The e2e harness boots WITH the bridge
// configured (playwright.e2e.config.ts sets CAIRN_COLLAB_INTERNAL_URL), so
// per the plan's layer swap the unconfigured-state behavior is pinned here
// and the e2e spec guards the configured/no-pill path end-to-end.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeDegradedPill } from '@/components/editor/bridge-degraded-pill';
import { I18nProvider } from '@/lib/i18n/provider';
import arMessages from '../../../messages/ar.json' with { type: 'json' };
import enMessages from '../../../messages/en.json' with { type: 'json' };
import esMessages from '../../../messages/es.json' with { type: 'json' };

afterEach(cleanup);

describe('<BridgeDegradedPill>', () => {
  it('renders an announced status pill with the i18n label + explanatory title', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <BridgeDegradedPill />
      </I18nProvider>,
    );
    const pill = screen.getByRole('status');
    expect(pill.textContent).toContain('API writes need reload');
    expect(pill.getAttribute('title')).toContain('collab bridge is not configured');
    // Icon stays out of the accessible name.
    expect(pill.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has translations in all three locales', () => {
    for (const messages of [enMessages, esMessages, arMessages]) {
      const m = messages as Record<string, string>;
      expect(m['editor.bridgeWarning.label']).toBeTruthy();
      expect(m['editor.bridgeWarning.title']).toBeTruthy();
    }
  });
});
