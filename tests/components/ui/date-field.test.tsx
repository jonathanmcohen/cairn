// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from '@/components/ui/date-field';

afterEach(cleanup);

describe('<DateField> (themed popover calendar, not a native date input)', () => {
  it('renders a button trigger (NOT an input[type=date]) showing the value', () => {
    const { container } = render(
      <DateField label="Due by" value="2026-05-24" onChange={() => {}} />,
    );
    // No native date input anywhere — that native control was the root cause of #29.
    expect(container.querySelector('input[type="date"]')).toBeNull();
    const trigger = screen.getByRole('button', { name: /due by/i });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toContain('2026-05-24');
  });

  it('shows a placeholder when value is empty', () => {
    render(<DateField label="From" value="" onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /from/i });
    expect(trigger.textContent && trigger.textContent.trim().length).toBeTruthy();
  });

  it('opens the calendar and picking a day emits an ISO YYYY-MM-DD string', () => {
    const onChange = vi.fn();
    render(<DateField label="Due by" value="2026-05-15" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /due by/i }));
    // The calendar grid is open: day cells are buttons labeled by day number.
    const day20 = screen.getByRole('button', { name: '20' });
    fireEvent.click(day20);
    expect(onChange).toHaveBeenCalledWith('2026-05-20');
  });

  it('exposes the label and meets a 44px touch target on the trigger', () => {
    render(<DateField label="To" value="" onChange={() => {}} id="to-field" />);
    const trigger = screen.getByRole('button', { name: /to/i });
    expect(trigger.className).toContain('min-h-11');
  });
});
