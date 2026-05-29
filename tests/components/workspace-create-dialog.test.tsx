// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
// IconPicker dynamically imports emoji-picker-element (a web component) — stub it
// so the modal renders in jsdom without the picker's browser-only deps.
vi.mock('@/components/icon-picker', () => ({
  IconPicker: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => onChange('emoji::🪨')}>
      pick-icon
    </button>
  ),
}));

afterEach(cleanup);

describe('<WorkspaceCreateDialog>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disables Create until a non-empty name is entered, then POSTs name + icon', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'ws1' }), { status: 201 }));
    render(<WorkspaceCreateDialog open onOpenChange={() => {}} />);

    const submit = screen.getByRole('button', { name: /create workspace/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // empty name → disabled

    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: '  ' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // whitespace-only → still disabled

    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick-icon' }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Acme', icon: 'emoji::🪨' }),
      }),
    );
  });
});
