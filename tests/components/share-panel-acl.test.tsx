// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { SharePanel } from '@/components/pages/share-panel';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (String(input).includes('/acls')) {
        return new Response(JSON.stringify({ acls: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ members: [] }), { status: 200 });
    }),
  );
});

describe('<SharePanel> includes ACL management (#167)', () => {
  it('renders the "People with access" section', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <SharePanel pageId="00000000-0000-0000-0000-000000000002" />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText(enMessages['share.acl.title'])).toBeTruthy());
  });
});
