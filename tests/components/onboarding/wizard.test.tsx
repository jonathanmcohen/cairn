// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasOnboarded, resetOnboardingForTests } from '@/components/onboarding/storage';
import { OnboardingWizard } from '@/components/onboarding/wizard';

// Stub next/navigation — the wizard uses useRouter for router.push/refresh
// after instantiate, but we don't need real navigation in unit tests.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  resetOnboardingForTests();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Default: /api/templates returns the welcome built-in only.
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url === '/api/templates') {
      return new Response(
        JSON.stringify({
          templates: [{ id: 't-welcome', name: 'Welcome to Cairn', kind: 'page', builtIn: true }],
        }),
        { status: 200 },
      );
    }
    if (typeof url === 'string' && url.endsWith('/instantiate') && init?.method === 'POST') {
      return new Response(JSON.stringify({ rootPageId: 'new-page-id', rootDatabaseId: null }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  resetOnboardingForTests();
  cleanup();
});

describe('<OnboardingWizard>', () => {
  it('renders nothing when hasAnyUserPages is true', () => {
    render(
      <OnboardingWizard
        workspaceId="ws-1"
        initialState={{ hasAnyUserPages: true, workspaceName: 'My WS' }}
      />,
    );
    expect(screen.queryByRole('dialog', { name: /welcome to cairn/i })).toBeNull();
  });

  it('renders nothing when the workspace has already been onboarded', () => {
    // Pre-mark; wizard should no-op.
    window.localStorage.setItem('cairn:onboarded:ws-1', '1');
    render(
      <OnboardingWizard
        workspaceId="ws-1"
        initialState={{ hasAnyUserPages: false, workspaceName: 'My WS' }}
      />,
    );
    expect(screen.queryByRole('dialog', { name: /welcome to cairn/i })).toBeNull();
  });

  it('renders the welcome step on a brand-new workspace', async () => {
    render(
      <OnboardingWizard
        workspaceId="ws-1"
        initialState={{ hasAnyUserPages: false, workspaceName: 'My WS' }}
      />,
    );
    expect(await screen.findByRole('dialog', { name: /welcome to cairn/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /get started/i })).toBeTruthy();
  });

  it('marks onboarded on Skip and dismisses the dialog', async () => {
    render(
      <OnboardingWizard
        workspaceId="ws-1"
        initialState={{ hasAnyUserPages: false, workspaceName: 'My WS' }}
      />,
    );
    await screen.findByRole('dialog', { name: /welcome to cairn/i });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    });
    expect(screen.queryByRole('dialog', { name: /welcome to cairn/i })).toBeNull();
    expect(hasOnboarded('ws-1')).toBe(true);
  });

  it('clicking "Set up workspace" with the welcome template POSTs the instantiate route + marks onboarded', async () => {
    render(
      <OnboardingWizard
        workspaceId="ws-1"
        initialState={{ hasAnyUserPages: false, workspaceName: 'My WS' }}
      />,
    );
    await screen.findByRole('dialog', { name: /welcome to cairn/i });

    // Step 1 -> 2.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    });
    await screen.findByLabelText(/workspace name/i);

    // Step 2 -> 3.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    });

    // Step 3: pick the template card.
    const card = await screen.findByText('Welcome to Cairn');
    await act(async () => {
      fireEvent.click(card);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /set up workspace/i }));
    });

    await waitFor(() => {
      const instantiateCalls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/instantiate'),
      );
      expect(instantiateCalls.length).toBe(1);
      expect((instantiateCalls[0]?.[1] as RequestInit).method).toBe('POST');
    });
    expect(hasOnboarded('ws-1')).toBe(true);
  });

  it('"Start blank" on step 3 marks onboarded without calling instantiate', async () => {
    render(
      <OnboardingWizard
        workspaceId="ws-1"
        initialState={{ hasAnyUserPages: false, workspaceName: 'My WS' }}
      />,
    );
    await screen.findByRole('dialog', { name: /welcome to cairn/i });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    });
    await screen.findByText('Welcome to Cairn');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start blank/i }));
    });

    const instantiateCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/instantiate'),
    );
    expect(instantiateCalls.length).toBe(0);
    expect(hasOnboarded('ws-1')).toBe(true);
  });
});
