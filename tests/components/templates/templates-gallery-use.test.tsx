// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplatesGallery } from '@/components/templates/templates-gallery';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup — do it explicitly below.

// next/navigation is heavy; mock the bits the gallery uses.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// P14 asserts on toast.error calls (message + retry action), so mock sonner.
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// Note: useConfirm() from @/components/ui/confirm-dialog needs no provider at
// render time (it only throws when *invoked*), and these tests never click
// Delete — so no ConfirmProvider wrapper is required.

const en = enMessages as Record<string, string>;

function renderGallery() {
  return render(
    <I18nProvider locale="en" messages={en}>
      <TemplatesGallery
        initialTemplates={[{ id: 'tpl-1', name: 'Meeting notes', kind: 'page', builtIn: false }]}
      />
    </I18nProvider>,
  );
}

type ToastOptions = { action: { label: string; onClick: () => void } };

function lastToastCall(): [string, ToastOptions] {
  const calls = vi.mocked(toast.error).mock.calls;
  return calls[calls.length - 1] as unknown as [string, ToastOptions];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('<TemplatesGallery> use-template (P14)', () => {
  it('POSTs to the instantiate endpoint with an AbortSignal attached', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rootPageId: 'p1', rootDatabaseId: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderGallery();

    fireEvent.click(screen.getByTestId('template-use'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/templates/tpl-1/instantiate');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('shows the timeout copy inline + via toast on AbortError, then re-enables the button', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderGallery();

    fireEvent.click(screen.getByTestId('template-use'));

    // Inline <p> error renders the dedicated timeout copy…
    await screen.findByText(en['templates.use.timeout'] as string);
    // …and the toast carries the same message with a Retry action.
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = lastToastCall();
    expect(message).toBe(en['templates.use.timeout']);
    expect(options.action.label).toBe(en['templates.use.retry']);

    // busy released → label back to the CTA and the button is clickable again.
    const button = screen.getByTestId('template-use') as HTMLButtonElement;
    expect(button.textContent).toBe(en['templates.use.cta']);
    expect(button.disabled).toBe(false);
  });

  it('toasts on a 500 response and the Retry action re-invokes the request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderGallery();

    fireEvent.click(screen.getByTestId('template-use'));
    await screen.findByText('boom');

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = lastToastCall();
    expect(message).toBe('boom');
    expect(options.action.label).toBe(en['templates.use.retry']);

    // Clicking Retry runs onUse again → a second fetch.
    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('does not toast on fast success and re-enables the button', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rootPageId: 'p1', rootDatabaseId: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderGallery();

    fireEvent.click(screen.getByTestId('template-use'));
    await waitFor(() => {
      expect((screen.getByTestId('template-use') as HTMLButtonElement).disabled).toBe(false);
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId('template-use').textContent).toBe(en['templates.use.cta']);
    expect(screen.queryByText(en['templates.use.timeout'] as string)).toBeNull();
  });
});
