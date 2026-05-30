// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  getAuthContext: vi.fn(async () => ({ userId: 'u1', workspaceId: 'ws1', role: 'admin' })),
}));
// The Swagger client loads a ~2MB bundle on mount; stub it.
vi.mock('@/app/api-docs/swagger-ui-client', () => ({
  default: () => <div data-testid="swagger-ui" />,
}));
// Render the authoritative English copy so we can assert the back-link text.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import ApiDocsPage from '@/app/api-docs/page';

afterEach(cleanup);

describe('/api-docs page', () => {
  it('renders a back-to-Cairn header link and the Swagger UI', async () => {
    const ui = await ApiDocsPage();
    render(ui);
    const back = screen.getByRole('link', { name: /back to cairn/i });
    expect(back.getAttribute('href')).toBe('/');
    expect(screen.getByTestId('swagger-ui')).toBeTruthy();
  });
});
