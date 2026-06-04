// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_MODE_STORAGE_KEY } from '@/components/pages/page-mode-shell';
import { type TemplateCard, TemplatesGallery } from '@/components/templates/templates-gallery';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../../messages/en.json';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tpl: TemplateCard = {
  id: 't1',
  name: 'Meeting notes',
  kind: 'page',
  builtIn: true,
  workspaceId: null,
  visibility: 'public',
};

describe('Use template resets focus mode (#63/#247)', () => {
  it('drops the persisted focus flag and navigates to the new page', async () => {
    window.localStorage.setItem(
      PAGE_MODE_STORAGE_KEY,
      JSON.stringify({ focus: true, reader: false }),
    );
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ rootPageId: 'p1', rootDatabaseId: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <I18nProvider locale="en" messages={en}>
        <TemplatesGallery initialTemplates={[tpl]} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/pages/p1'));
    const stored = JSON.parse(window.localStorage.getItem(PAGE_MODE_STORAGE_KEY) ?? '{}');
    expect(stored.focus).toBe(false);
  });
});
