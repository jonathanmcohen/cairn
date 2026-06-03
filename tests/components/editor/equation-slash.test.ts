import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bus from '@/components/editor/editor-dialog-bus';
import { SLASH_ITEMS } from '@/components/editor/slash-extension';

// The Equation slash item lazy-loads the math extension before issuing setMath.
// Stub the loader so the deferred chain resolves synchronously-ish in the test.
vi.mock('@/components/editor/extensions-lazy', () => ({
  loadEditorExtension: vi.fn(async () => ({ name: 'math' })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** A chained editor stub recording the final setMath call (mirrors citation-slash style). */
function makeEditorStub() {
  const run = vi.fn();
  const setMath = vi.fn().mockReturnValue({ run });
  const chain: Record<string, unknown> = {
    focus: () => chain,
    deleteRange: () => chain,
    run,
    setMath,
  };
  return {
    isDestroyed: false,
    extensionManager: { extensions: [{ name: 'math' }] },
    chain: () => chain,
    setOptions: vi.fn(),
    setMath,
  };
}

describe('Equation slash item is modal-first', () => {
  it('opens the equation dialog and reaches setMath with the collected latex', async () => {
    const item = SLASH_ITEMS.find((i) => i.title === 'Equation');
    expect(item).toBeDefined();
    if (!item) throw new Error('Equation item missing');

    const openSpy = vi
      .spyOn(bus, 'openEditorDialog')
      .mockResolvedValue({ kind: 'equation', latex: 'x^2', display: true });

    const editor = makeEditorStub();
    // Slash items take (editor, range); call as the suggestion command does.
    item.command(editor as never, { from: 1, to: 1 });

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]).toMatchObject({ kind: 'equation' });

    // Let the dialog promise + lazy-load promise chain flush.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(editor.setMath).toHaveBeenCalledWith({ latex: 'x^2', display: true });
  });
});
