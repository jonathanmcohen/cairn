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

  it('renders a lucide chevron in the Preview disclosure (no raw marker)', () => {
    const welcomeBuiltInTemplate = tpl({
      name: 'Welcome to Cairn',
      kind: 'page',
      builtIn: true,
      workspaceId: null,
      visibility: 'public',
    });
    render(<TemplatesGallery initialTemplates={[welcomeBuiltInTemplate]} />);
    const summary = screen.getByText('Preview').closest('summary');
    expect(summary?.querySelector('svg')).toBeTruthy();
    expect(summary?.className).toContain('list-none');
  });

  it('renders the kind badge and the Built-in badge with distinct styling', () => {
    const builtInPageTemplate = tpl({
      name: 'Welcome to Cairn',
      kind: 'page',
      builtIn: true,
      workspaceId: null,
      visibility: 'public',
    });
    render(<TemplatesGallery initialTemplates={[builtInPageTemplate]} />);
    const kind = screen.getByText('page').closest('span');
    const builtIn = screen.getByText('Built-in').closest('span');
    expect(kind?.className).not.toEqual(builtIn?.className);
    // kind badge carries a leading lucide icon (decorative)
    expect(kind?.querySelector('svg')).toBeTruthy();
  });

  it('uses a 4-col grid at xl so a 4th card fills the row instead of orphaning', () => {
    const fourPublicTemplates = [
      tpl({ name: 'B1', builtIn: true, workspaceId: null, visibility: 'public' }),
      tpl({ name: 'B2', builtIn: true, workspaceId: null, visibility: 'public' }),
      tpl({ name: 'B3', builtIn: true, workspaceId: null, visibility: 'public' }),
      tpl({ name: 'B4', builtIn: true, workspaceId: null, visibility: 'public' }),
    ];
    const { container } = render(<TemplatesGallery initialTemplates={fourPublicTemplates} />);
    const grid = container.querySelector('section [class*="grid-cols"]');
    expect(grid?.className).toContain('xl:grid-cols-4');
    expect(grid?.className).toContain('sm:grid-cols-2');
  });
});
