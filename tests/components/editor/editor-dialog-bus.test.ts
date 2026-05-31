import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EditorDialogRequest,
  openEditorDialog,
  resetEditorDialogBus,
  subscribeEditorDialog,
} from '@/components/editor/editor-dialog-bus';

afterEach(() => resetEditorDialogBus());

describe('editor dialog bus', () => {
  it('delivers the request to the subscriber and resolves with its result', async () => {
    const seen: EditorDialogRequest[] = [];
    subscribeEditorDialog((req) => {
      seen.push(req);
      req.resolve({ text: 'hello' });
    });
    const result = await openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('footnote');
    expect(result).toEqual({ text: 'hello' });
  });

  it('resolves null when the subscriber cancels', async () => {
    subscribeEditorDialog((req) => req.resolve(null));
    const result = await openEditorDialog({ kind: 'citation', title: 'Citation' });
    expect(result).toBeNull();
  });

  it('resolves null immediately when there is no subscriber', async () => {
    const result = await openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    expect(result).toBeNull();
  });

  it('unsubscribe stops delivery', async () => {
    const handler = vi.fn();
    const unsub = subscribeEditorDialog(handler);
    unsub();
    await openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    expect(handler).not.toHaveBeenCalled();
  });
});
