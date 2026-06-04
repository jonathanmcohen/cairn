// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TemplateCard, TemplatesGallery } from '@/components/templates/templates-gallery';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../../messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderGallery(templates: TemplateCard[], activeWorkspaceId?: string) {
  return render(
    <I18nProvider locale="en" messages={en}>
      <TemplatesGallery initialTemplates={templates} activeWorkspaceId={activeWorkspaceId} />
    </I18nProvider>,
  );
}

const builtInPage: TemplateCard = {
  id: 'b1',
  name: 'Welcome',
  kind: 'page',
  builtIn: true,
  workspaceId: null,
  visibility: 'public',
};

const workspaceDatabase: TemplateCard = {
  id: 'w1tpl',
  name: 'Tasks DB',
  kind: 'database',
  builtIn: false,
  workspaceId: 'w1',
  visibility: 'workspace',
};

describe('TemplatesGallery card pills (#69/#250)', () => {
  it('renders the kind label Proper-cased with an icon indicator', () => {
    renderGallery([builtInPage, workspaceDatabase], 'w1');
    // Proper-cased labels, not the raw lowercase kind word.
    expect(screen.getByText('Page')).toBeTruthy();
    expect(screen.getByText('Database')).toBeTruthy();
    expect(screen.queryByText('page')).toBeNull();
    expect(screen.queryByText('database')).toBeNull();

    const pageKind = screen.getByTestId('tpl-kind-page');
    const dbKind = screen.getByTestId('tpl-kind-database');
    expect(pageKind.querySelector('svg')).toBeTruthy();
    expect(dbKind.querySelector('svg')).toBeTruthy();
  });

  it('shows Built-in as muted text, not a filled primary pill', () => {
    renderGallery([builtInPage], 'w1');
    const builtIn = screen.getByText('Built-in');
    expect(builtIn.className).toContain('text-muted-foreground');
    expect(builtIn.className).not.toContain('bg-primary');
  });

  it('still shows In this workspace for own-workspace rows', () => {
    renderGallery([workspaceDatabase], 'w1');
    expect(screen.getByText('In this workspace')).toBeTruthy();
  });
});
