import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bus from '@/components/editor/editor-dialog-bus';
import { citationMenuItem, footnoteMenuItem } from '@/components/editor/slash-extension';

// stub lazy dynamic imports used inside the resolve paths
vi.mock('@/lib/citations/format', () => ({
  formatCitation: vi.fn(() => 'APA'),
}));
vi.mock('@/components/editor/extensions/citation', () => ({
  CitationExtension: { name: 'citation' },
}));
vi.mock('@/components/editor/blocks/footnote-mark', () => ({
  FootnoteMark: { name: 'footnote' },
}));

afterEach(() => {
  vi.restoreAllMocks();
  bus.resetEditorDialogBus();
});

function makeEditorStub() {
  const run = vi.fn();
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'run') return run;
        return () => chain;
      },
    },
  );
  return {
    isDestroyed: false,
    extensionManager: { extensions: [] as { name: string }[] },
    chain: () => chain,
    setOptions: vi.fn(),
    state: {
      doc: {
        textBetween: vi.fn(() => ''),
      },
    },
  };
}

describe('citation + footnote slash entries — basic shape', () => {
  it('/citation present', () => {
    expect(citationMenuItem.command).toBe('/citation');
    expect(typeof citationMenuItem.run).toBe('function');
  });
  it('/footnote present', () => {
    expect(footnoteMenuItem.command).toBe('/footnote');
    expect(typeof footnoteMenuItem.run).toBe('function');
  });
});

describe('citation slash — deferred range consume (#76 #136 → B1)', () => {
  // #76 → B1 — the trigger range is consumed when the dialog RESOLVES (insert
  // on commit, cancelSlashTrigger on cancel), never synchronously on open.
  // Popup teardown on open is owned by the Suggestion `render().onExit`. B1
  // changed the cancel half: leaving the `/query` wedged re-triggering
  // (dismissedRange + allowedPrefixes), so cancel now deletes the trigger too;
  // only pre-trigger body text survives.
  it('does NOT consume the range synchronously on open for citationMenuItem', () => {
    vi.spyOn(bus, 'openEditorDialog').mockReturnValue(new Promise(() => {})); // never resolves
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = { focus: () => ({ deleteRange }) };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    citationMenuItem.run(editor as never, range);

    // Dialog still open → no commit → trigger text untouched.
    expect(deleteRange).not.toHaveBeenCalled();
  });

  it('does NOT consume the range synchronously on open for footnoteMenuItem', () => {
    vi.spyOn(bus, 'openEditorDialog').mockReturnValue(new Promise(() => {})); // never resolves
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = { focus: () => ({ deleteRange }) };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    footnoteMenuItem.run(editor as never, range);

    expect(deleteRange).not.toHaveBeenCalled();
  });

  it('on cancel (null result), citationMenuItem does NOT insert but DOES consume the trigger (B1)', async () => {
    vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
    const insertContent = vi.fn();
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = {
      focus: () => ({ deleteRange, insertContent }),
    };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    citationMenuItem.run(editor as never, range);

    await new Promise((r) => setTimeout(r, 0));

    // Cancel → no insert, but the `/query` trigger is removed so the slash
    // menu can re-fire (B1 — the wedge fix).
    expect(insertContent).not.toHaveBeenCalled();
    expect(deleteRange).toHaveBeenCalledTimes(1);
    expect(deleteRange).toHaveBeenCalledWith(range);
  });

  it('on cancel (null result), footnoteMenuItem does NOT set mark but DOES consume the trigger (B1)', async () => {
    vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
    const setMark = vi.fn();
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = {
      focus: () => ({ deleteRange, setMark }),
    };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    footnoteMenuItem.run(editor as never, range);

    await new Promise((r) => setTimeout(r, 0));

    expect(setMark).not.toHaveBeenCalled();
    expect(deleteRange).toHaveBeenCalledTimes(1);
    expect(deleteRange).toHaveBeenCalledWith(range);
  });
});
