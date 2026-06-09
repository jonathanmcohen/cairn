// @vitest-environment jsdom
/**
 * Plan F (MCP OAuth) — OAuth connections list. Renders OauthConnectionsList with
 * two fake rows and asserts each shows client name + scopes + last-used + a
 * Revoke button; clicking Revoke calls /api/oauth-connections DELETE and
 * optimistically removes the row (Active-Sessions style).
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import {
  type OauthConnectionRow,
  OauthConnectionsList,
} from '@/components/dev-settings/oauth-connections-list';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const rows: OauthConnectionRow[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    clientName: 'Claude Desktop',
    scopes: ['mcp:read'],
    lastUsedAt: new Date().toISOString(),
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    clientName: 'Cursor',
    scopes: ['mcp:read', 'mcp:write'],
    lastUsedAt: null,
  },
];

function renderList(initial = rows) {
  return render(
    createElement(
      I18nProvider,
      // children supplied via the variadic arg below; cast keeps the required
      // `children` prop off the props object (avoids noChildrenProp).
      { locale: 'en', messages: enMessages as Record<string, string> } as never,
      createElement(OauthConnectionsList, { initial }),
    ),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Plan F — OAuth connections list', () => {
  it('shows each grant: client name, scopes, and last-used / never-used', () => {
    const { container } = renderList();
    expect(container.textContent).toContain('Claude Desktop');
    expect(container.textContent).toContain('Cursor');
    expect(container.textContent).toContain('mcp:read, mcp:write');
    // a never-used connection shows the "Never used" copy
    expect(container.textContent).toContain('Never used');
  });

  it('each grant has a Revoke button', () => {
    renderList();
    const revokes = screen.getAllByRole('button', { name: 'Revoke' });
    expect(revokes.length).toBe(2);
  });

  it('clicking Revoke calls the DELETE endpoint and removes the row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderList();

    const firstRevoke = screen.getAllByRole('button', { name: 'Revoke' })[0];
    if (!firstRevoke) throw new Error('no revoke button');
    fireEvent.click(firstRevoke);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dev/oauth-connections/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      { method: 'DELETE' },
    );
    await waitFor(() => {
      expect(container.textContent).not.toContain('Claude Desktop');
    });
    // the other row remains
    expect(container.textContent).toContain('Cursor');
  });

  it('empty list shows the empty-state copy', () => {
    const { container } = renderList([]);
    expect(container.textContent).toContain('No connected apps yet');
  });
});
