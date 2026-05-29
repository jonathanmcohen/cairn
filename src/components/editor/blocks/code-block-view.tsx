'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Command } from 'cmdk';
import { Check, ChevronDown } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { LANGUAGES } from './code-block';

function LanguagePicker({
  value,
  label,
  onSelect,
}: {
  value: string;
  label: string;
  onSelect: (next: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.value === value);
  const currentLabel = current?.label ?? value;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        // role=combobox is implicit on a button with aria-haspopup=listbox in
        // the a11y tree; set it explicitly so the existing test query matches.
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex h-11 min-h-11 w-36 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-xs shadow-xs transition-colors',
          'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          className="z-50 w-48 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <Command className="flex flex-col">
            <Command.Input
              placeholder={t('editor.codeBlock.searchLanguage')}
              className="h-11 border-b bg-transparent px-3 text-sm outline-hidden placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
                {t('editor.codeBlock.noLanguage')}
              </Command.Empty>
              {LANGUAGES.map((l) => (
                <Command.Item
                  key={l.value}
                  value={`${l.label} ${l.value}`}
                  onSelect={() => {
                    onSelect(l.value);
                    setOpen(false);
                  }}
                  className="flex min-h-11 cursor-pointer select-none items-center justify-between rounded-sm px-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <span>{l.label}</span>
                  {l.value === value ? <Check className="h-4 w-4" /> : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

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
  //
  // v0.9.4 P26 #105 — the language picker is a cmdk-backed filterable popover
  // (not the radix Select listbox, which can't host an editable filter input).
  // The trigger keeps role="combobox" + aria-label so the a11y contract and the
  // tests are preserved. The only new local state is the popover's `open` flag
  // (UI-only, never persisted) — Yjs-safe; the chosen value still writes through
  // `updateAttributes` exactly as before.
  const t = useT();
  const language = (node.attrs.language as string | null) || 'auto';
  return (
    <NodeViewWrapper className="cairn-codeblock group/codeblock relative">
      {editor.isEditable && (
        <div
          contentEditable={false}
          className="absolute right-2 top-2 z-10 flex items-center gap-1"
        >
          {/* Copy button is added in Task 2 (#106) — leave room here. */}
          <LanguagePicker
            value={language}
            label={t('editor.codeBlock.language')}
            onSelect={(v) => updateAttributes({ language: v === 'auto' ? null : v })}
          />
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
