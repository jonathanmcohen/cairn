import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import { Button as UIButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ButtonNode, sanitizeButtonHref } from './button-node';

type Variant = 'primary' | 'secondary';

function ButtonView({ node, editor, updateAttributes }: NodeViewProps) {
  const label = ((node.attrs.label as string | null | undefined) ?? 'Button') as string;
  const href = ((node.attrs.href as string | null | undefined) ?? '#') as string;
  const variant: Variant = node.attrs.variant === 'secondary' ? 'secondary' : 'primary';
  const [editing, setEditing] = useState(!href || href === '#');
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftHref, setDraftHref] = useState(href === '#' ? '' : href);
  const [draftVariant, setDraftVariant] = useState<Variant>(variant);

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-md border p-3">
        <div className="space-y-2">
          <Input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Label"
          />
          <Input
            value={draftHref}
            onChange={(e) => setDraftHref(e.target.value)}
            placeholder="https://example.com"
          />
          <div className="flex gap-2">
            <UIButton
              type="button"
              variant={draftVariant === 'primary' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDraftVariant('primary')}
            >
              Primary
            </UIButton>
            <UIButton
              type="button"
              variant={draftVariant === 'secondary' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDraftVariant('secondary')}
            >
              Secondary
            </UIButton>
          </div>
          <UIButton
            type="button"
            size="sm"
            onClick={() => {
              updateAttributes({
                label: draftLabel || 'Button',
                href: sanitizeButtonHref(draftHref || '#'),
                variant: draftVariant,
              });
              setEditing(false);
            }}
          >
            Save
          </UIButton>
        </div>
      </NodeViewWrapper>
    );
  }

  const safeHref = sanitizeButtonHref(href);
  const isExternal = safeHref.startsWith('http');
  return (
    <NodeViewWrapper className="my-3">
      <a
        href={safeHref}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={`btn inline-block rounded-md px-3 py-1.5 text-sm ${variant === 'secondary' ? 'btn-secondary border bg-secondary text-secondary-foreground' : 'btn-primary bg-primary text-primary-foreground'}`}
      >
        {label}
      </a>
      {editor.isEditable && (
        <UIButton
          type="button"
          variant="ghost"
          size="sm"
          className="ml-2"
          onClick={() => setEditing(true)}
        >
          Edit
        </UIButton>
      )}
    </NodeViewWrapper>
  );
}

/** Client extension: the schema-only node + its React node view. */
export const ButtonBlock = ButtonNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ButtonView);
  },
});
