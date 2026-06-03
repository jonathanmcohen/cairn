import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bus from '@/components/editor/editor-dialog-bus';
import { SLASH_ITEMS } from '@/components/editor/slash-extension';

// Lazy loaders are stubbed so the deferred commands don't try to import the
// real extension bundles. The assertion only cares that openEditorDialog fired.
vi.mock('@/components/editor/extensions-lazy', () => ({
  loadEditorExtension: vi.fn(async () => ({ name: 'stub' })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** Minimal chained editor stub: every chain method returns the chain. */
function makeEditorStub() {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'run') return () => undefined;
        return () => chain;
      },
    },
  );
  return {
    isDestroyed: false,
    extensionManager: { extensions: [] },
    chain: () => chain,
    setOptions: vi.fn(),
  };
}

describe('slash input commands are modal-first (#274 #64)', () => {
  it('each of Equation/Citation/Footnote/Flashcard opens a dialog exactly once', () => {
    for (const title of ['Equation', 'Citation', 'Footnote', 'Flashcard']) {
      const item = SLASH_ITEMS.find((i) => i.title === title);
      expect(item, `${title} slash item missing`).toBeDefined();
      if (!item) continue;

      const openSpy = vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
      const editor = makeEditorStub();
      item.command(editor as never, { from: 1, to: 1 });
      expect(openSpy, `${title} should be modal-first`).toHaveBeenCalledTimes(1);
      openSpy.mockRestore();
    }
  });

  it('does NOT open a dialog for a non-input control item (Heading 1)', () => {
    const item = SLASH_ITEMS.find((i) => i.title === 'Heading 1');
    expect(item).toBeDefined();
    if (!item) return;
    const openSpy = vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
    item.command(makeEditorStub() as never, { from: 1, to: 1 });
    expect(openSpy).not.toHaveBeenCalled();
  });
});
