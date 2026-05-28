// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTimeView } from '@/components/editor/extensions/datetime';

afterEach(() => cleanup());

describe('DateTimeView', () => {
  it('renders the local-tz formatted string + original-tz badge', () => {
    const { container } = render(
      <DateTimeView
        node={{
          attrs: {
            iso: '2026-05-26T15:00:00.000Z',
            tz: 'America/New_York',
            display_format: 'yyyy-LL-dd HH:mm',
          },
        }}
        viewerTz="UTC"
      />,
    );
    expect(within(container).getByText('2026-05-26 15:00')).toBeTruthy();
    expect(within(container).getByText(/America\/New_York/)).toBeTruthy();
  });

  it('exposes an aria-label that includes the formatted value + original tz', () => {
    const { container } = render(
      <DateTimeView
        node={{
          attrs: {
            iso: '2026-05-26T15:00:00.000Z',
            tz: 'America/New_York',
            display_format: 'yyyy-LL-dd HH:mm',
          },
        }}
        viewerTz="America/New_York"
      />,
    );
    const time = within(container).getByRole('button');
    expect(time.getAttribute('aria-label')).toContain('2026-05-26 11:00');
    expect(time.getAttribute('aria-label')).toContain('America/New_York');
  });

  it('renders a semantic <time> element with the datetime attribute', () => {
    const { container } = render(
      <DateTimeView
        node={{
          attrs: {
            iso: '2026-05-26T15:00:00.000Z',
            tz: 'UTC',
            display_format: 'yyyy-LL-dd HH:mm',
          },
        }}
        viewerTz="UTC"
      />,
    );
    const timeEl = container.querySelector('time');
    expect(timeEl).toBeTruthy();
    expect(timeEl?.getAttribute('datetime')).toBe('2026-05-26T15:00:00.000Z');
  });
});
