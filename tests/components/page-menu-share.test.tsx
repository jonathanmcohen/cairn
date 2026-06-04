// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
afterEach(cleanup);

describe('PageMenu share launcher (#120)', () => {
  it('opens the Share modal from "Manage sharing…" when published', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <PageMenu pageId="p1" initialPublished initialSlug="my-page" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.trigger'] }));
    fireEvent.click(screen.getByRole('button', { name: en['share.menuLabel'] }));
    expect(screen.getByRole('dialog', { name: en['share.title'] })).toBeTruthy();
  });
});
