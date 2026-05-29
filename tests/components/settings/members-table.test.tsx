// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembersTable } from '@/app/(app)/settings/workspace/members/members-table';

// next/navigation is used only for router.refresh(); stub it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const members = [
  { userId: 'u-owner', name: 'Ona Owner', email: 'ona@x.test', role: 'owner' as const },
  { userId: 'u-admin', name: 'Ada Admin', email: 'ada@x.test', role: 'admin' as const },
  { userId: 'u-self', name: 'Me Myself', email: 'me@x.test', role: 'editor' as const },
];

function renderTable() {
  return render(<MembersTable workspaceId="ws-1" members={members} currentUserId="u-self" />);
}

describe('<MembersTable>', () => {
  it('does not render a Remove button on the owner row', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: 'Remove ona@x.test' })).toBeNull();
  });

  it('does not render a Remove button on the current-user row', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: 'Remove me@x.test' })).toBeNull();
  });

  it('renders a Remove button for a removable member (admin, not self)', () => {
    renderTable();
    expect(screen.getByRole('button', { name: 'Remove ada@x.test' })).toBeTruthy();
  });

  it('renders roles Title-Cased for display (owner row)', () => {
    renderTable();
    const ownerRow = screen.getByText('Ona Owner').closest('tr')!;
    expect(within(ownerRow).getByText('Owner')).toBeTruthy();
    expect(within(ownerRow).queryByText('owner')).toBeNull();
  });

  it('keeps the role <option> values lowercase for the editable role select', () => {
    renderTable();
    const select = screen.getByRole('combobox', { name: 'Change role for ada@x.test' });
    const values = Array.from(select.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toEqual(['viewer', 'editor', 'admin']);
  });
});
