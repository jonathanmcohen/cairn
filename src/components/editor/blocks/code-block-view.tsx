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
  const language = (node.attrs.language as string | null) || 'auto';
  return (
    <NodeViewWrapper className="cairn-codeblock relative">
      {editor.isEditable && (
        <div contentEditable={false} className="absolute right-2 top-2 z-10">
          <Select
            value={language}
            onValueChange={(v) => updateAttributes({ language: v === 'auto' ? null : v })}
          >
            <SelectTrigger aria-label="Code language" className="h-7 w-36 text-xs">
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
