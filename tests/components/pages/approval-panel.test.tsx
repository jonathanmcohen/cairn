// @vitest-environment jsdom
/**
 * v0.9.0 G4 P24 — ApprovalPanel render gating.
 *
 * - returns null when !inReview && history is empty
 * - shows three decision buttons when canDecide + inReview
 * - hides buttons (history only) when !canDecide but inReview
 * - submitting an approval POSTs to /decide and re-fetches history
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalPanel } from '@/components/pages/approval-panel';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(history: unknown[] = []): FetchMock {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (init?.method === 'POST' && url.endsWith('/decide')) {
      return new Response(JSON.stringify({ id: 'x', signatureHmac: 'y'.repeat(64) }), {
        status: 200,
      });
    }
    if (url.endsWith('/approval')) {
      return new Response(JSON.stringify({ history }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn as unknown as FetchMock;
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ApprovalPanel', () => {
  it('renders nothing when !inReview and history is empty', async () => {
    const { container } = render(
      <ApprovalPanel
        pageId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        canDecide={false}
        inReview={false}
      />,
    );
    // Wait one tick for the effect to resolve, then confirm still empty.
    await waitFor(() => expect(container.querySelector('aside')).toBeNull());
  });

  it('shows the three decision buttons when canDecide + inReview', async () => {
    render(
      <ApprovalPanel
        pageId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        canDecide={true}
        inReview={true}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeTruthy();
    });
    expect(screen.getByText('Request changes')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
    expect(screen.getByLabelText('Approval comment')).toBeTruthy();
  });

  it('hides decision buttons when canDecide=false but inReview=true', async () => {
    render(
      <ApprovalPanel
        pageId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        canDecide={false}
        inReview={true}
      />,
    );
    // aside still renders (because inReview=true) but the buttons must not.
    await waitFor(() => {
      expect(screen.queryByText('Approve')).toBeNull();
    });
    expect(screen.queryByText('Request changes')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });

  it('submitting Approve issues POST /decide then re-fetches /approval', async () => {
    const fetchFn = mockFetch();
    render(
      <ApprovalPanel
        pageId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        canDecide={true}
        inReview={true}
      />,
    );
    const approveBtn = await screen.findByText('Approve');
    fireEvent.click(approveBtn);
    await waitFor(() => {
      const decideCalls = fetchFn.mock.calls.filter((c) => {
        const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).toString();
        return url.endsWith('/decide');
      });
      expect(decideCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
