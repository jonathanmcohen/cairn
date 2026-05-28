// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksTable, type TasksTableRow } from '@/app/(app)/my-tasks/tasks-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
});

const seed: TasksTableRow[] = [
  {
    pageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    workspaceId: 'wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww',
    blockId: 'b1',
    text: 'Sample',
    checked: false,
    dueAtIso: '2026-06-01T00:00:00.000Z',
    pageTitle: 'Page',
    pageIcon: null,
  },
];

describe('TasksTable', () => {
  it('renders rows and shows the due date', () => {
    render(<TasksTable initialTasks={seed} initialStatus="open" />);
    expect(screen.getByText('Sample')).toBeTruthy();
    expect(screen.getByText(/2026-06-01/)).toBeTruthy();
  });

  it('renders empty state when no tasks', () => {
    render(<TasksTable initialTasks={[]} initialStatus="open" />);
    expect(screen.getByText(/No tasks/)).toBeTruthy();
  });

  it('exposes accessible filter buttons', () => {
    render(<TasksTable initialTasks={seed} initialStatus="open" />);
    expect(screen.getByRole('group', { name: /Filter by status/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'all' })).toBeTruthy();
  });

  it('renders an accessible checkbox per row', () => {
    render(<TasksTable initialTasks={seed} initialStatus="open" />);
    expect(screen.getByRole('checkbox', { name: /Toggle Sample/ })).toBeTruthy();
  });
});
