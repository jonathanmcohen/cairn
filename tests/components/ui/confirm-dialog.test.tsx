// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider, useConfirm } from '@/components/ui/confirm-dialog';

afterEach(cleanup);

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({
          title: 'Move to trash?',
          confirmLabel: 'Move to trash',
          variant: 'danger',
        });
        onResult(ok);
      }}
    >
      open
    </button>
  );
}

describe('<ConfirmProvider> / useConfirm', () => {
  it('renders a themed dialog (not a native popup) with the title + danger action', async () => {
    render(
      <ConfirmProvider>
        <Harness onResult={() => {}} />
      </ConfirmProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('open'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();
    expect(screen.getByText('Move to trash?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('resolves true when the action button is clicked', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Harness onResult={onResult} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    // Dialog closes after resolving.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resolves false when cancelled', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Harness onResult={onResult} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('resolves false when dismissed with Escape', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Harness onResult={onResult} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
