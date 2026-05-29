// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '@/components/settings/copy-button';

afterEach(cleanup);

describe('<CopyButton>', () => {
  it('writes the value to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value="abc-123" label="Copy User ID" />);
    fireEvent.click(screen.getByRole('button', { name: /copy user id/i }));
    expect(writeText).toHaveBeenCalledWith('abc-123');
  });
});
