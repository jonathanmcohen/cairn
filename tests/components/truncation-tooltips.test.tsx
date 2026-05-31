// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { ForwardersView } from '@/app/(app)/settings/admin/siem/forwarders-view';
import { MembersTable } from '@/app/(app)/settings/workspace/members/members-table';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/(app)/admin/siem/forwarder-form', () => ({ ForwarderForm: () => null }));

afterEach(cleanup);

describe('truncation title tooltips', () => {
  it('members table cells carry a title', () => {
    render(
      <MembersTable
        workspaceId="w1"
        currentUserId="u2"
        members={[{ userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'editor' }]}
      />,
    );
    expect(screen.getByTitle('Ada Lovelace')).toBeTruthy();
    expect(screen.getByTitle('ada@example.com')).toBeTruthy();
  });

  it('forwarder endpoint carries a title', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <ForwardersView
          forwarders={[
            {
              id: 'f1',
              kind: 'syslog',
              name: 'Prod',
              endpoint: 'udp://collector.internal:514',
              enabled: true,
            },
          ]}
        />
      </I18nProvider>,
    );
    expect(screen.getByTitle('udp://collector.internal:514')).toBeTruthy();
  });
});
