// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ScheduleRowView, SchedulesManager } from '@/components/settings/schedules-manager';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROW: ScheduleRowView = {
  id: 'abc-123',
  workspaceId: null,
  command: 'trash:purge',
  cronSpec: '0 3 * * *',
  nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  enabled: true,
};

describe('SchedulesManager', () => {
  it('renders a row per schedule with its command and cron', () => {
    renderWithI18n(<SchedulesManager initial={[ROW]} />);
    expect(screen.getByTestId('schedule-row-abc-123')).toBeTruthy();
    expect((screen.getByTestId('schedule-cron-abc-123') as HTMLInputElement).value).toBe(
      '0 3 * * *',
    );
    expect(screen.getByText('trash:purge')).toBeTruthy();
  });

  it('saves an edited cron expression via PATCH', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ schedule: { ...ROW, cronSpec: '*/5 * * * *' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<SchedulesManager initial={[ROW]} />);
    fireEvent.change(screen.getByTestId('schedule-cron-abc-123'), {
      target: { value: '*/5 * * * *' },
    });
    fireEvent.click(screen.getByTestId('schedule-save-abc-123'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/schedules/abc-123');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ cronSpec: '*/5 * * * *' });
  });

  it('toggles enabled via PATCH', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ schedule: { ...ROW, enabled: false } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<SchedulesManager initial={[ROW]} />);
    fireEvent.click(screen.getByTestId('schedule-enabled-abc-123'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/schedules/abc-123');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ enabled: false });
  });

  it('rolls the toggle back when PATCH fails', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<SchedulesManager initial={[ROW]} />);
    const toggle = screen.getByTestId('schedule-enabled-abc-123');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByTestId('schedules-status')).toBeTruthy());
    // Optimistic flip was rolled back to enabled=true.
    expect(screen.getByTestId('schedule-enabled-abc-123').getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('runs a job now via POST', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ schedule: { ...ROW, nextRunAt: new Date().toISOString() } }),
          {
            status: 200,
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<SchedulesManager initial={[ROW]} />);
    fireEvent.click(screen.getByTestId('schedule-run-abc-123'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/schedules/abc-123/run');
    expect(opts.method).toBe('POST');
  });

  it('renders an empty state when there are no schedules', () => {
    renderWithI18n(<SchedulesManager initial={[]} />);
    expect(screen.getByTestId('schedules-empty')).toBeTruthy();
  });
});
