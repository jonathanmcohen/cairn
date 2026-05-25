import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    button: {
      /** Insert an inline-CTA button block (label/href/variant attrs). */
      setButton: (attrs?: {
        label?: string;
        href?: string;
        variant?: 'primary' | 'secondary';
      }) => ReturnType;
    };
  }
}

/**
 * Reject any href whose scheme isn't http/https/mailto by collapsing it to `#`.
 * Anything that fails `URL` parsing — non-strings, free-form text, or malformed
 * schemes — is also collapsed. Exported for direct unit-testing (see
 * tests/components/editor/blocks/button.test.ts).
 */
export function sanitizeButtonHref(raw: unknown): string {
  if (typeof raw !== 'string') return '#';
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      return u.toString();
    }
    return '#';
  } catch {
    return '#';
  }
}

function variantClass(v: unknown): string {
  return v === 'secondary'
    ? 'btn btn-secondary border bg-secondary text-secondary-foreground'
    : 'btn btn-primary bg-primary text-primary-foreground';
}

/**
 * v0.8.0 P24 button node — atomic block with attrs `{label, href, variant}`
 * rendered as `<a class="btn ..." href="...">label</a>`. Yjs-safe (attrs only,
 * no node-local state). Public-page render reuses the same `renderHTML`.
 *
 * The React node-view lives in `button.tsx` (a `.extend()` wrapper that adds
 * a small edit popover); this file holds the schema-only spec so the v0.3.0
 * custom-node Yjs audit can import it without pulling React.
 */
export const ButtonNode = Node.create({
  name: 'button',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      label: { default: 'Button' },
      href: { default: '#' },
      variant: { default: 'primary' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-cairn-button]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return {
            label: el.textContent ?? 'Button',
            href: el.getAttribute('href') ?? '#',
            variant: el.getAttribute('data-variant') === 'secondary' ? 'secondary' : 'primary',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const href = sanitizeButtonHref(node.attrs.href);
    const cls = variantClass(node.attrs.variant);
    const variant = node.attrs.variant === 'secondary' ? 'secondary' : 'primary';
    const label = typeof node.attrs.label === 'string' ? node.attrs.label : 'Button';
    const isExternal = href.startsWith('http');
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-button': '',
        'data-variant': variant,
        href,
        class: `${cls} inline-block rounded-md px-3 py-1.5 text-sm`,
        ...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
      }),
      label,
    ];
  },

  addCommands() {
    return {
      setButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              label: attrs?.label ?? 'Button',
              href: attrs?.href ?? '#',
              variant: attrs?.variant ?? 'primary',
            },
          }),
    };
  },
});
