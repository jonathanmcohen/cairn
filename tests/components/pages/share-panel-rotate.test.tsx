// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel } from '@/components/pages/share-panel';

const fetchSpy = vi.fn();
const clipboardSpy = vi.fn(async () => undefined);

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  clipboardSpy.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardSpy },
  });
  // jsdom doesn't ship crypto.getRandomValues on the global; node provides it.
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues<T extends ArrayBufferView>(arr: T): T {
          if (arr instanceof Uint8Array) {
            for (let i = 0; i < arr.byteLength; i++) arr[i] = i;
          }
          return arr;
        },
      },
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

describe('<SharePanel> rotate password (v0.9.0 G6 P33)', () => {
  it('PATCHes /api/pages/<id>/share with a fresh password string + copies it', async () => {
    render(<SharePanel pageId="p1" initialHasPassword={true} />);
    fireEvent.click(screen.getByRole('button', { name: /rotate password/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('/api/pages/p1/share');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as { password?: string };
    expect(typeof body.password).toBe('string');
    expect(body.password!.length).toBeGreaterThanOrEqual(12);
    expect(body.password).not.toContain('+');
    expect(body.password).not.toContain('/');
    expect(body.password).not.toContain('=');
    await waitFor(() => expect(clipboardSpy).toHaveBeenCalled());
  });

  it('falls back to inline reveal when clipboard write fails', async () => {
    clipboardSpy.mockRejectedValueOnce(new Error('blocked'));
    render(<SharePanel pageId="p1" initialHasPassword={true} />);
    fireEvent.click(screen.getByRole('button', { name: /rotate password/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/Rotated\. New password:/);
    });
  });
});
