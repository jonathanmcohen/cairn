// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRowActionsMenu } from '@/components/sidebar/page-row-actions-menu';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// Resolve the keys this surface uses to their English labels so accessible
// names read naturally (the dotted keys alone wouldn't match the role-name
// regexes below — the point of the assertion is that the *names* are correct).
const LABELS: Record<string, string> = {
  'pageRow.addChild': 'Add subpage',
  'pageRow.actions': 'Page actions',
  'pageRow.rename': 'Rename',
  'pageMenu.moveToTrash': 'Move to trash',
  'pageMenu.duplicate': 'Duplicate page',
  'pageMenu.copyLink': 'Copy link',
  'pageMenu.moveTo': 'Move to…',
};
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => LABELS[k] ?? k }));

afterEach(cleanup);

const node = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Doc',
  spaceId: null,
  depth: 0,
  icon: null,
} as unknown as import('@/lib/pages/tree').FlatPageNode;

describe('<PageRowActionsMenu>', () => {
  it('renders an add-child button and a menu trigger, both keyboard-reachable (in DOM, not hidden)', () => {
    render(<PageRowActionsMenu node={node} />);
    const add = screen.getByRole('button', { name: /add (a )?(sub)?page|add child/i });
    const more = screen.getByRole('button', { name: /(page )?actions|more/i });
    expect(add).toBeTruthy();
    expect(more).toBeTruthy();
    // Touch-target gate: both clear ≥44px.
    expect(add.className).toMatch(/min-h-11|h-11/);
    expect(more.className).toMatch(/min-h-11|h-11/);
  });

  it('opens the actions menu and shows Rename + Move to trash', async () => {
    render(<PageRowActionsMenu node={node} />);
    const trigger = screen.getByRole('button', { name: /(page )?actions|more/i });
    // Radix DropdownMenu opens on keyboard activation (it ignores synthetic
    // click in jsdom because it gates on pointer events). Same pattern as
    // tests/components/pages/export-menu.test.tsx.
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /trash/i })).toBeTruthy();
  });
});
