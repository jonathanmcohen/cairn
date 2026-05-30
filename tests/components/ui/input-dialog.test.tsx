// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputDialogProvider, usePrompt } from '@/components/ui/input-dialog';

afterEach(cleanup);

function Harness({ onResult, type }: { onResult: (v: string | null) => void; type?: 'password' }) {
  const prompt = usePrompt();
  return (
    <button
      type="button"
      onClick={async () => {
        const value = await prompt({
          title: 'Name your workspace',
          label: 'Workspace name',
          placeholder: 'e.g. Acme HQ',
          type,
        });
        onResult(value);
      }}
    >
      open
    </button>
  );
}

describe('<InputDialogProvider> / usePrompt', () => {
  it('resolves the entered value on submit', async () => {
    const onResult = vi.fn();
    render(
      <InputDialogProvider>
        <Harness onResult={onResult} />
      </InputDialogProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    const field = (await screen.findByLabelText('Workspace name')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Homelab' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('Homelab'));
  });

  it('resolves null on cancel (matching window.prompt)', async () => {
    const onResult = vi.fn();
    render(
      <InputDialogProvider>
        <Harness onResult={onResult} />
      </InputDialogProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });

  it('masks input when type=password', async () => {
    render(
      <InputDialogProvider>
        <Harness onResult={() => {}} type="password" />
      </InputDialogProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    const field = (await screen.findByLabelText('Workspace name')) as HTMLInputElement;
    expect(field.type).toBe('password');
  });
});
