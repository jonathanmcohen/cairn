// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

afterEach(cleanup);

describe('sidebar lower nav', () => {
  it('includes a Settings link to /settings', () => {
    render(<SidebarFooterNav version="0.0.0" />);
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings.getAttribute('href')).toBe('/settings');
  });
});
