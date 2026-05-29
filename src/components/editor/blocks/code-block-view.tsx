'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LANGUAGES } from './code-block';

export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  // `language` is the ONLY persisted state and it lives entirely in the node
  // attr (never node-local React state) — Yjs-safe. `auto` maps to a null attr.
  //
  // v0.9.2 P09 Task 2 — "Auto" detection: selecting Auto stores a NULL
  // `language` attr. `@tiptap/extension-code-block-lowlight` already
  // best-effort auto-detects in that case: its ProseMirror highlight plugin
  // falls back to `lowlight.highlightAuto(textContent)` whenever the node's
  // `language` (and the extension `defaultLanguage`, which is null here) is
  // falsy — so untagged code still gets highlighted. We deliberately do NOT
  // run detection in this NodeView and write the result back to the attr:
  // mutating the doc on render would cause Yjs churn / sync loops. Detection
  // stays display-only (the plugin's decorations); the stored attr remains
  // null until the user explicitly picks a language.
  const language = (node.attrs.language as string | null) || 'auto';
  return (
    <NodeViewWrapper className="cairn-codeblock relative">
      {editor.isEditable && (
        <div contentEditable={false} className="absolute right-2 top-2 z-10">
          <Select
            value={language}
            onValueChange={(v) => updateAttributes({ language: v === 'auto' ? null : v })}
          >
            <SelectTrigger aria-label="Code language" className="h-9 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <pre className="hljs">
        <NodeViewContent<'code'>
          as="code"
          className={language && language !== 'auto' ? `language-${language}` : undefined}
        />
      </pre>
    </NodeViewWrapper>
  );
}
