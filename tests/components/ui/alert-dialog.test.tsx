// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertProvider, useAlert } from '@/components/ui/alert-dialog';

afterEach(cleanup);

function Harness({ onDone }: { onDone: () => void }) {
  const alert = useAlert();
  return (
    <button
      type="button"
      onClick={async () => {
        await alert({ title: 'Heads up', description: 'Saved.' });
        onDone();
      }}
    >
      open
    </button>
  );
}

describe('<AlertProvider> / useAlert', () => {
  it('shows the message and resolves on OK', async () => {
    const onDone = vi.fn();
    render(
      <AlertProvider>
        <Harness onDone={onDone} />
      </AlertProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('Heads up')).toBeTruthy();
    expect(screen.getByText('Saved.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('throws when invoked outside the provider', () => {
    let alert: ReturnType<typeof useAlert> | undefined;
    function Bad() {
      alert = useAlert();
      return null;
    }
    render(<Bad />);
    expect(() => alert?.({ title: 'x' })).toThrow(/useAlert must be used inside/);
  });
});
