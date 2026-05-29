// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRowContextMenu } from '@/components/sidebar/page-row-context-menu';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// Resolve keys to English labels so the role-name regexes match (the dotted
// keys alone wouldn't); the assertion is about the menu carrying the right set.
const LABELS: Record<string, string> = {
  'pageRow.rename': 'Rename',
  'pageRow.addChild': 'Add subpage',
  'pageMenu.duplicate': 'Duplicate page',
  'pageMenu.copyLink': 'Copy link',
  'pageMenu.moveTo': 'Move to…',
  'pageMenu.moveToTrash': 'Move to trash',
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

describe('<PageRowContextMenu>', () => {
  it('opens an app context menu on right-click with the canonical actions', async () => {
    render(
      <PageRowContextMenu node={node}>
        <div data-testid="row">Doc</div>
      </PageRowContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('row'));
    expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /copy link/i })).toBeTruthy();
    // "Move to…" and "Move to trash" both contain "move to" — disambiguate.
    expect(screen.getByRole('menuitem', { name: 'Move to…' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /trash/i })).toBeTruthy();
  });
});
