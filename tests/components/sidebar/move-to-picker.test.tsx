// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveToPicker } from '@/components/sidebar/move-to-picker';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

const NODES = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    parentId: null,
    title: 'Alpha',
    icon: null,
    depth: 0,
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    parentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title: 'Beta',
    icon: null,
    depth: 1,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    parentId: null,
    title: 'Gamma',
    icon: null,
    depth: 0,
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/pages/tree') {
        return new Response(JSON.stringify({ nodes: NODES }), { status: 200 });
      }
      // move endpoint: 204 No Content
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Beta — moving it must hide Beta + its descendants + itself.
const SOURCE = NODES[1] as (typeof NODES)[number];

describe('MoveToPicker', () => {
  it('lists destinations and a top-level option, excluding the source subtree', async () => {
    render(<MoveToPicker open sourceId={SOURCE.id} onOpenChange={() => {}} onMoved={() => {}} />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    // Top-level option present.
    expect(screen.getByText('moveTo.topLevel')).toBeTruthy();
    // The source page itself is not a valid destination.
    expect(screen.queryByText('Beta')).toBeNull();
    // A sibling/other page is selectable.
    expect(screen.getByText('Gamma')).toBeTruthy();
  });

  it('filters destinations by the search query', async () => {
    render(<MoveToPicker open sourceId={SOURCE.id} onOpenChange={() => {}} onMoved={() => {}} />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('moveTo.searchPlaceholder'), {
      target: { value: 'gam' },
    });
    expect(screen.getByText('Gamma')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('POSTs newParentId on select and reports the move', async () => {
    const onMoved = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MoveToPicker open sourceId={SOURCE.id} onOpenChange={onOpenChange} onMoved={onMoved} />,
    );
    await waitFor(() => expect(screen.getByText('Gamma')).toBeTruthy());
    fireEvent.click(screen.getByText('Gamma'));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const moveCall = fetchMock.mock.calls.find(([u]) => u === `/api/pages/${SOURCE.id}/move`);
    expect(moveCall).toBeTruthy();
    const init = moveCall?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      newParentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('top-level option POSTs newParentId null', async () => {
    const onMoved = vi.fn();
    render(<MoveToPicker open sourceId={SOURCE.id} onOpenChange={() => {}} onMoved={onMoved} />);
    await waitFor(() => expect(screen.getByText('moveTo.topLevel')).toBeTruthy());
    fireEvent.click(screen.getByText('moveTo.topLevel'));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const moveCall = fetchMock.mock.calls.find(([u]) => u === `/api/pages/${SOURCE.id}/move`);
    expect(JSON.parse((moveCall?.[1] as RequestInit).body as string)).toEqual({
      newParentId: null,
    });
  });
});
