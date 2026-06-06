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

describe('citation slash — popup destroy + range leak fix (#76 #136)', () => {
  it('consumeSlashRange is called synchronously before the dialog resolves for citationMenuItem', () => {
    // The fix: consumeSlashRange must be called before openEditorDialog resolves
    // so that TipTap's onExit fires and the popup is destroyed immediately on open.
    vi.spyOn(bus, 'openEditorDialog').mockReturnValue(new Promise(() => {})); // never resolves
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = { focus: () => ({ deleteRange }) };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    citationMenuItem.run(editor as never, range);

    // consumeSlashRange calls editor.chain().focus().deleteRange(range).run()
    expect(deleteRange).toHaveBeenCalledWith(range);
  });

  it('consumeSlashRange is called synchronously before the dialog resolves for footnoteMenuItem', () => {
    vi.spyOn(bus, 'openEditorDialog').mockReturnValue(new Promise(() => {})); // never resolves
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = { focus: () => ({ deleteRange }) };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    footnoteMenuItem.run(editor as never, range);

    expect(deleteRange).toHaveBeenCalledWith(range);
  });

  it('on cancel (null result), citationMenuItem does NOT insert and range was already consumed', async () => {
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

    // Range consumed synchronously before dialog
    expect(deleteRange).toHaveBeenCalledWith(range);

    await new Promise((r) => setTimeout(r, 0));

    // No insert on cancel
    expect(insertContent).not.toHaveBeenCalled();
  });

  it('on cancel (null result), footnoteMenuItem does NOT set mark and range was already consumed', async () => {
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

    expect(deleteRange).toHaveBeenCalledWith(range);

    await new Promise((r) => setTimeout(r, 0));

    expect(setMark).not.toHaveBeenCalled();
  });
});
