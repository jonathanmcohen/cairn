'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';

export function ToggleView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const open = node.attrs.open !== false;
  // Empty = a single empty child block (the default `[{paragraph}]`) with no
  // text. Read-only: derived purely from the live node, never written back —
  // Yjs-safe (the placeholder is presentational DOM, never a doc node).
  const isEmpty = node.textContent.trim() === '' && node.childCount <= 1;
  const showPlaceholder = open && editor.isEditable && isEmpty;

  return (
    <NodeViewWrapper data-type="toggle" className="cairn-toggle">
      <div className="flex items-start gap-1">
        <button
          type="button"
          contentEditable={false}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
          onClick={() => updateAttributes({ open: !open })}
          className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {/* Content hole: child blocks live here. Hidden (not unmounted) when
            collapsed so the document/Yjs state is untouched by the toggle.
            When open + editable + empty, an overlaid presentational hint sits
            on top of the (empty) content hole. It's `pointer-events-none` so a
            click falls through to the editable paragraph; `contentEditable=false`
            keeps it out of the ProseMirror/Yjs document. */}
        <div className={`relative flex-1 ${open ? '' : 'hidden'}`}>
          <NodeViewContent
            // viewers (editable=false) keep content visible regardless of `open`
            // when the node-view is absent; here we honor `open` interactively.
            data-toggle-open={open ? 'true' : 'false'}
          />
          {showPlaceholder && (
            <span
              contentEditable={false}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 text-sm text-muted-foreground"
            >
              Empty — add content…
            </span>
          )}
        </div>
        {!open && (
          <span
            contentEditable={false}
            className="mt-0.5 flex-1 truncate text-sm text-muted-foreground"
          >
            {editor.isEditable ? 'Toggle (collapsed)' : ''}
          </span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
