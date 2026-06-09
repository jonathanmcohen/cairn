// @vitest-environment jsdom
/**
 * Plan F (MCP OAuth) — consent screen UI. Renders the themed OauthConsentScreen
 * with a fake client + scopes + workspace and asserts the client name, friendly
 * scope labels (shared Mint-Token tooltips), workspace name, and Allow/Cancel
 * controls are present + accessible.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { OauthConsentScreen } from '@/components/dev-settings/oauth-consent-screen';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderConsent() {
  return render(
    createElement(
      I18nProvider,
      // children supplied via the variadic arg below; cast keeps the required
      // `children` prop off the props object (avoids noChildrenProp).
      { locale: 'en', messages: enMessages as Record<string, string> } as never,
      createElement(OauthConsentScreen, {
        clientName: 'Cursor',
        workspaceName: 'Homelab',
        scopes: ['mcp:read', 'pages:read'],
        hidden: { client_id: 'abc', redirect_uri: 'http://localhost/cb' },
      }),
    ),
  );
}

describe('Plan F — OAuth consent screen', () => {
  it('shows the client name and target workspace', () => {
    const { container } = renderConsent();
    expect(container.textContent).toContain('Cursor');
    expect(container.textContent).toContain('Homelab');
  });

  it('lists requested scopes with the friendly Mint-Token tooltips', () => {
    const { container } = renderConsent();
    const readTip = (enMessages as Record<string, string>)['devTokens.scope.mcp:read.tip'];
    expect(container.textContent).toContain(readTip);
    expect(container.querySelectorAll('[data-scope]').length).toBe(2);
  });

  it('has accessible Allow + Cancel actions; Allow posts the grant', () => {
    renderConsent();
    const allow = screen.getByRole('button', { name: 'Allow' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(allow).toBeTruthy();
    expect(cancel).toBeTruthy();
    expect(allow.getAttribute('name')).toBe('decision');
    expect(allow.getAttribute('value')).toBe('allow');
    const form = allow.closest('form');
    expect(form?.getAttribute('action')).toBe('/api/oauth/authorize');
    expect(form?.getAttribute('method')).toBe('post');
  });

  it('round-trips the hidden authorize params', () => {
    const { container } = renderConsent();
    const hidden = container.querySelector('input[name="client_id"]') as HTMLInputElement | null;
    expect(hidden?.value).toBe('abc');
  });
});
