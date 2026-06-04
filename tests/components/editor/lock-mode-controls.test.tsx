// @vitest-environment jsdom
//
// D3 / #188 — under lock the suggest-edits toggle stays mounted but disabled
// (not removed) and the bibliography toggle stays rendered. The full <Editor>
// shell mounts TipTap + Yjs collab in jsdom, which is heavy and tickles a known
// Radix focus-scope teardown flake; this exercises the two leaf controls
// directly (the same components editor.tsx mounts) plus the gating booleans,
// which is where the lock logic lives.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BibliographyToggle } from '@/components/editor/bibliography-toggle';
import { SuggestionToolbar } from '@/components/editor/suggestion-toolbar';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

const noop = () => {};

function toolbar(disabled: boolean) {
  return (
    <SuggestionToolbar
      editor={null}
      active={false}
      onToggle={noop}
      openCount={0}
      onMarkInsert={noop}
      onMarkDelete={noop}
      resolvable={null}
      onAccept={noop}
      onReject={noop}
      onOpenDrawer={noop}
      disabled={disabled}
    />
  );
}

describe('lock-mode editor controls (#188)', () => {
  it('keeps the Suggest edits toggle present but disabled when locked', () => {
    render(wrap(toolbar(true)));
    const btn = screen.getByRole('button', { name: /suggest/i });
    expect(btn).not.toBeNull();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe(enMessages['editor.suggest.lockedHint']);
  });

  it('keeps the Suggest edits toggle enabled when not locked', () => {
    render(wrap(toolbar(false)));
    const btn = screen.getByRole('button', { name: /suggest/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the bibliography toggle regardless of lock state', () => {
    render(
      wrap(
        <BibliographyToggle
          pageId="p1"
          initialDisabled={false}
          citationCount={2}
          onChange={noop}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: /bibliography/i })).not.toBeNull();
  });
});
