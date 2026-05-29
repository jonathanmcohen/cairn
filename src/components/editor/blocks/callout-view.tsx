'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { AlertTriangle, Info, Lightbulb, OctagonX, StickyNote } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CALLOUT_VARIANTS, type CalloutVariant } from '../callout-extension';

const META: Record<CalloutVariant, { label: string; Icon: typeof Info }> = {
  note: { label: 'Note', Icon: StickyNote },
  tip: { label: 'Tip', Icon: Lightbulb },
  warning: { label: 'Warning', Icon: AlertTriangle },
  error: { label: 'Error', Icon: OctagonX },
  info: { label: 'Info', Icon: Info },
};

export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) ?? 'note';
  const { Icon } = META[variant] ?? META.note;
  return (
    <NodeViewWrapper
      className={`callout callout-${variant}`}
      data-type="callout"
      data-variant={variant}
    >
      <div className="flex items-start gap-2">
        <span contentEditable={false} className="callout-icon mt-0.5 shrink-0" aria-hidden>
          <Icon className="size-4" />
        </span>
        <NodeViewContent className="min-w-0 flex-1" />
        {editor.isEditable && (
          <div contentEditable={false} className="shrink-0">
            <Select
              value={variant}
              onValueChange={(v) => updateAttributes({ variant: v as CalloutVariant })}
            >
              <SelectTrigger aria-label="Callout type" className="h-9 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALLOUT_VARIANTS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {META[v].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
