// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
afterEach(cleanup);

describe('<PageMenu> new actions', () => {
  it('renders Duplicate, Move to, Move to trash, and Copy link', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" canMove />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    expect(await screen.findByRole('button', { name: /duplicate page/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to trash/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to…/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
  });

  // v0.10.2 P1 — Lock + Bibliography moved here from the page toolbar. The
  // lock item keeps its own accessible name (re-routed from the old toolbar
  // tooltip test); bibliography is a plain action that dispatches the
  // `cairn:bibliography:toggle` event the editor listens for.
  it('renders Lock page (canLock) and Bibliography items', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" canLock />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    expect(await screen.findByRole('button', { name: 'Lock page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bibliography' })).toBeTruthy();
  });

  it('clicking Bibliography dispatches cairn:bibliography:toggle', async () => {
    const seen = vi.fn();
    window.addEventListener('cairn:bibliography:toggle', seen);
    try {
      render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" />);
      screen.getByRole('button', { name: 'Page menu' }).click();
      fireEvent.click(await screen.findByRole('button', { name: 'Bibliography' }));
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('cairn:bibliography:toggle', seen);
    }
  });

  it('hides Lock and Move for viewers (no canLock/canMove)', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    expect(await screen.findByRole('button', { name: /copy link/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lock page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock page' })).toBeNull();
    expect(screen.queryByRole('button', { name: /move to…/i })).toBeNull();
  });
});
