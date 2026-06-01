// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('swr', () => ({ default: () => ({ data: { unreadCount: 5 }, mutate: () => {} }) }));

import { NotificationBell } from '@/components/notifications/bell';

afterEach(cleanup);

describe('notification bell badge text size', () => {
  it('badge is not text-[10px]', () => {
    const { container } = render(<NotificationBell />);
    expect(container.querySelector('[class*="text-[10px]"]')).toBeNull();
    // the unread badge still shows the count
    expect(container.textContent).toContain('5');
  });
});
