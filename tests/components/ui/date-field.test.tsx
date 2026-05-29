// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateField } from '@/components/ui/date-field';

afterEach(cleanup);

describe('<DateField>', () => {
  it('renders a date input with the given value and label', () => {
    render(<DateField label="Due by" value="2026-05-24" onChange={() => {}} />);
    const input = screen.getByLabelText('Due by') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-05-24');
    expect(input.className).toContain('rounded-md');
  });
});
