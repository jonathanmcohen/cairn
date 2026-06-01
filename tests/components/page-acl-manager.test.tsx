// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { PageAclManager } from '@/components/pages/page-acl-manager';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (String(input).includes('/acls')) {
        return new Response(
          JSON.stringify({
            acls: [
              {
                userId: 'u1',
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                image: null,
                permission: 'edit',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ members: [] }), { status: 200 });
    }),
  );
});

describe('<PageAclManager> (#167)', () => {
  it('renders the section title and an existing grant', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <PageAclManager pageId="00000000-0000-0000-0000-000000000001" />
      </I18nProvider>,
    );
    expect(screen.getByText(enMessages['share.acl.title'])).toBeTruthy();
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
  });
});
