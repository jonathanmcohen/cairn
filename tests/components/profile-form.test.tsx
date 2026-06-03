// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import { ProfileForm } from '@/components/account/profile-form';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProfileForm (#198 K4)', () => {
  it('seeds the input, PATCHes /api/users/me on submit, and shows success copy', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'New Name' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    render(<ProfileForm initialName="Old Name" />);

    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    expect(input.value).toBe('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe('/api/users/me');
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(String(init.body)).toContain('name');

    await waitFor(() => {
      expect(screen.getByText('Profile updated')).toBeTruthy();
    });
  });
});
