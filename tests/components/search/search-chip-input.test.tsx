// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchChipInput } from '@/components/search/search-chip-input';

afterEach(() => {
  cleanup();
});

describe('<SearchChipInput>', () => {
  it('renders an empty input by default', () => {
    render(<SearchChipInput initialValue="" onChange={() => {}} />);
    const el = screen.getByLabelText('Search') as HTMLInputElement;
    expect(el.value).toBe('');
  });

  it('collapses `key:value<space>` into a chip', () => {
    const onChange = vi.fn();
    render(<SearchChipInput initialValue="" onChange={onChange} />);
    const input = screen.getByLabelText('Search');
    fireEvent.change(input, { target: { value: 'from:alice ' } });
    expect(screen.getByText('from:alice')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ ops: [{ key: 'from', value: 'alice' }] }),
    );
  });

  it('removes a chip when the X button is clicked', () => {
    render(<SearchChipInput initialValue="from:alice " onChange={() => {}} />);
    const remove = screen.getByRole('button', { name: /remove from:alice/i });
    fireEvent.click(remove);
    expect(screen.queryByText('from:alice')).toBeNull();
  });

  it('opens the Add-filter menu + inserts an empty chip stub', () => {
    render(<SearchChipInput initialValue="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'tag' }));
    // After selection, the input value reflects the stub `tag:`.
    const input = screen.getByLabelText('Search') as HTMLInputElement;
    expect(input.value).toBe('tag:');
  });

  it('flags unknown operator keys', () => {
    render(<SearchChipInput initialValue="weird:val " onChange={() => {}} />);
    expect(screen.getByText(/unknown filter: weird/i)).toBeTruthy();
  });
});
