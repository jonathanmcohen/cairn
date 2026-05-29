import { ReactNodeViewRenderer } from '@tiptap/react';
import { Callout } from '../callout-extension';
import { CalloutView } from './callout-view';

/**
 * Interactive-editor variant of the schema-pure `Callout` node: attaches the
 * React node-view (icon + variant type picker). Kept separate from
 * `callout-extension.ts` because that base node is imported by the SERVER-SAFE
 * `schema.ts` (suggestion-transform), which must not drag the client-only
 * `CalloutView` (radix-ui/lucide) into the server bundle. Mirrors the
 * code-block split (`blocks/code-block.ts`).
 */
export const CalloutWithView = Callout.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
