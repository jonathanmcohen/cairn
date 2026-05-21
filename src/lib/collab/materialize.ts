import type { Schema } from 'prosemirror-model';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

/**
 * Convert a Yjs document binary (Hocuspocus-managed `page_yjs.state`) into
 * ProseMirror JSON suitable for writing to `pages.content`.
 *
 * LIMITATION: fidelity depends on the ProseMirror schema passed in. The full
 * conversion of Cairn's custom nodes (callout/image/file/database) requires the
 * editor's TipTap schema, which is only fully registered in the browser/editor
 * bundle (Plan 2). This function is schema-parameterized so Plan 2 supplies the
 * real schema; the unit test exercises prosemirror-schema-basic only.
 *
 * @param state    Yjs state as a full document update (Uint8Array).
 * @param _schema  ProseMirror schema (reserved for schema-aware conversion in Plan 2).
 * @param fragment The Y.XmlFragment key the editor binds to (default 'default').
 */
export function yjsStateToProseDoc(
  state: Uint8Array,
  _schema?: Schema,
  fragment = 'default',
): Record<string, unknown> {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return yDocToProsemirrorJSON(ydoc, fragment) as Record<string, unknown>;
}
