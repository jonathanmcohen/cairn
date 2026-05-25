// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetQuickCaptureForTests,
  openQuickCapture,
} from '@/components/quick-capture/controller';
import { QuickCaptureModal } from '@/components/quick-capture/modal';

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup. Without it, repeated render() calls
// accumulate in document.body across tests.

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ capturedPageId: 'p1', inboxPageId: 'i1' }), { status: 201 }),
  );
});

afterEach(() => {
  __resetQuickCaptureForTests();
  cleanup();
});

function openModal(): void {
  act(() => {
    openQuickCapture();
  });
}

describe('<QuickCaptureModal>', () => {
  it('is hidden initially and opens when openQuickCapture() fires', async () => {
    render(<QuickCaptureModal />);
    expect(screen.queryByRole('dialog', { name: /quick capture/i })).toBeNull();

    openModal();
    expect(await screen.findByRole('dialog', { name: /quick capture/i })).toBeTruthy();
  });

  it('POSTs the form to /api/inbox and closes on success', async () => {
    render(<QuickCaptureModal />);
    openModal();

    const titleInput = (await screen.findByLabelText(/title/i)) as HTMLInputElement;
    const noteInput = screen.getByLabelText(/note/i) as HTMLTextAreaElement;
    const urlInput = screen.getByLabelText(/url/i) as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'Hello' } });
    fireEvent.change(noteInput, { target: { value: 'A body' } });
    fireEvent.change(urlInput, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe('/api/inbox');
    expect((init as RequestInit).method).toBe('POST');
    expect(
      (init as RequestInit & { headers: Record<string, string> }).headers['content-type'],
    ).toBe('application/json');
    const body = JSON.parse((init as { body: string }).body) as {
      title: string;
      body: string;
      url: string | null;
    };
    expect(body).toEqual({ title: 'Hello', body: 'A body', url: 'https://example.com' });

    // After the success response, the dialog should close.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /quick capture/i })).toBeNull();
    });
  });

  it('stays open + surfaces the error on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );
    render(<QuickCaptureModal />);
    openModal();

    const titleInput = (await screen.findByLabelText(/title/i)) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'X' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });

    expect(await screen.findByText(/unauthorized/i)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /quick capture/i })).toBeTruthy();
  });

  it('refuses to submit when title is empty (form-level validation)', async () => {
    render(<QuickCaptureModal />);
    openModal();

    await screen.findByLabelText(/title/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    render(<QuickCaptureModal />);
    openModal();
    await screen.findByRole('dialog', { name: /quick capture/i });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /quick capture/i })).toBeNull();
    });
  });
});
