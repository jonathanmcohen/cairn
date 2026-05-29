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
});
