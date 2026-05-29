// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksTable } from '@/app/(app)/my-tasks/tasks-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

describe('my-tasks filter tabs', () => {
  it('renders Title-Case labels and marks the active filter with aria-pressed', () => {
    render(<TasksTable initialTasks={[]} initialStatus="open" />);
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open).toBeTruthy();
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
  });

  // #27 (reopened): the "Due by" control must be the themed Popover trigger
  // (a real <button>), not a bare native `<input type="date">`. The DateField
  // primitive was rewritten to a themed calendar popover (#29), which resolves
  // #27 transitively — this guards the my-tasks call site against a regression
  // back to a native date input.
  it('renders the "Due by" filter as a themed popover trigger, not a native date input', () => {
    const { container } = render(<TasksTable initialTasks={[]} initialStatus="open" />);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    const dueBy = screen.getByRole('button', { name: /due by/i });
    expect(dueBy.tagName).toBe('BUTTON');
    // themed surface + 44px touch target (WCAG 2.1 AA)
    expect(dueBy.className).toContain('rounded-md');
    expect(dueBy.className).toContain('min-h-11');
  });
});
