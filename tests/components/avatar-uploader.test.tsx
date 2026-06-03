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

import { AvatarUploader } from '@/components/account/avatar-uploader';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AvatarUploader (#199 K5)', () => {
  it('shows initials fallback and an upload control', () => {
    render(<AvatarUploader initialAvatarUrl={null} fallbackName="Jon Cohen" />);
    expect(screen.getByText('JC')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload avatar' })).toBeTruthy();
  });

  it('uploads the file, PATCHes the signed URL, and renders the new image', async () => {
    const signed = 'https://host/api/files/abc?sig=x&exp=1';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/upload') {
        return { ok: true, json: async () => ({ signedUrl: signed }) };
      }
      return { ok: true, json: async () => ({ avatarUrl: signed }) };
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <AvatarUploader initialAvatarUrl={null} fallbackName="Jon Cohen" />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/users/me')).toBe(true);
    });

    const uploadCall = calls.find((c) => c.url === '/api/upload');
    expect(uploadCall?.init?.method).toBe('POST');
    expect(uploadCall?.init?.body).toBeInstanceOf(FormData);
    expect((uploadCall?.init?.body as FormData).get('file')).toBe(file);

    const patchCall = calls.find((c) => c.url === '/api/users/me');
    expect(patchCall?.init?.method).toBe('PATCH');
    expect(String(patchCall?.init?.body)).toContain(signed);

    await waitFor(() => {
      const img = container.querySelector('img') as HTMLImageElement;
      expect(img?.getAttribute('src')).toBe(signed);
    });
  });
});
