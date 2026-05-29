// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';

vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
afterEach(cleanup);

describe('<PageMenu> new actions', () => {
  it('renders Duplicate, Move to, Move to trash, and Copy link', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    expect(await screen.findByRole('button', { name: /duplicate page/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to trash/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
  });
});
