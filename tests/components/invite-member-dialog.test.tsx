// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (typeof globalThis.navigator === 'undefined' || !navigator.clipboard) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: vi.fn() } },
      configurable: true,
    });
  }
});

import { InviteMemberDialog } from '@/app/(app)/settings/workspace/invites/invite-member-dialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InviteMemberDialog', () => {
  it('opens a modal whose trigger label matches and shows copy-link after creation', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'tok-123' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    render(<InviteMemberDialog workspaceId="ws-1" />);

    const trigger = screen.getByRole('button', { name: 'Invite member' });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);

    expect(await screen.findByText('Invite a member')).toBeTruthy();

    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => {
      expect(screen.getByText('Invite link created — share it with the invitee:')).toBeTruthy();
    });
    expect(screen.getByText(/\/invite\/tok-123/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeTruthy();
  });
});
