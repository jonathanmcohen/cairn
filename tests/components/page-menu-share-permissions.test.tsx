// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

// P1 — PageMenu now calls useRouter() for the lock/unlock refresh.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
afterEach(cleanup);

describe('PageMenu Share & permissions (#259)', () => {
  it('exposes Share & permissions for an unpublished page and opens the dialog', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <PageMenu pageId="11111111-1111-4111-8111-111111111111" initialPublished={false} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.trigger'] }));
    const share = screen.getByRole('button', { name: en['share.menuLabel'] });
    expect(share).toBeTruthy();
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: en['share.title'] })).toBeTruthy();
  });
});
