// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TemplateCard, TemplatesGallery } from '@/components/templates/templates-gallery';

// Stubbed navigation hooks — TemplatesGallery is a Client Component that
// imports `useRouter` from next/navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function tpl(over: Partial<TemplateCard>): TemplateCard {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'w1',
    name: 'T',
    kind: 'page',
    builtIn: false,
    visibility: 'workspace',
    ...over,
  };
}

describe('TemplatesGallery visibility grouping', () => {
  it('renders separate sections for each visibility that has rows', () => {
    render(
      <TemplatesGallery
        activeWorkspaceId="w1"
        initialTemplates={[
          tpl({ name: 'WsOne', visibility: 'workspace' }),
          tpl({ name: 'PubOne', visibility: 'public' }),
          tpl({ name: 'PrivOne', visibility: 'private' }),
        ]}
      />,
    );
    expect(screen.getByText('WsOne')).toBeTruthy();
    expect(screen.getByText('PubOne')).toBeTruthy();
    expect(screen.getByText('PrivOne')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'workspace' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'public' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'private' })).toBeTruthy();
  });

  it('omits empty sections', () => {
    render(
      <TemplatesGallery
        activeWorkspaceId="w1"
        initialTemplates={[tpl({ name: 'WsOnly', visibility: 'workspace' })]}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'public' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'private' })).toBeNull();
  });

  it('highlights templates owned by the active workspace', () => {
    render(
      <TemplatesGallery
        activeWorkspaceId="w1"
        initialTemplates={[
          tpl({ name: 'Mine', workspaceId: 'w1' }),
          tpl({ name: 'Theirs', workspaceId: 'w2', visibility: 'public' }),
        ]}
      />,
    );
    expect(screen.getByText(/In this workspace/)).toBeTruthy();
    // 'Theirs' belongs to w2; should NOT show the "In this workspace" badge —
    // its only chip is 'page'.
    expect(screen.getAllByText(/In this workspace/)).toHaveLength(1);
  });

  it('groups built-in (global) rows under the public tier', () => {
    render(
      <TemplatesGallery
        activeWorkspaceId="w1"
        initialTemplates={[
          tpl({ name: 'Welcome to Cairn', builtIn: true, workspaceId: null, visibility: 'public' }),
          tpl({ name: 'WsOne', visibility: 'workspace' }),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'public' })).toBeTruthy();
    expect(screen.getByText('Welcome to Cairn')).toBeTruthy();
  });
});
