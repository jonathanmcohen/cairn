// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WebhooksManager } from '@/components/settings/webhooks-manager';

afterEach(cleanup);

function openCreateForm() {
  render(<WebhooksManager initialHooks={[]} initialDeliveries={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
}

describe('<WebhooksManager> expanded event catalog (#257 #258)', () => {
  it('renders the full audited event catalog', () => {
    openCreateForm();
    for (const label of [
      'page.created',
      'row.created',
      'comment.created',
      'comment.resolved',
      'member.invited',
      'member.joined',
      'member.removed',
      'page.approved',
      'page.approval_rejected',
      'page.changes_requested',
      'page.locked',
      'page.unlocked',
      'page.status_changed',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('Select all checks every checkbox', () => {
    openCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((c) => c.checked)).toBe(true);
  });

  it('Recommended checks exactly the recommended subset', () => {
    openCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Recommended' }));
    const checked = (screen.getAllByRole('checkbox') as HTMLInputElement[]).filter(
      (c) => c.checked,
    ).length;
    expect(checked).toBe(4);
  });

  it('Clear unchecks all', () => {
    openCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.some((c) => c.checked)).toBe(false);
  });
});
