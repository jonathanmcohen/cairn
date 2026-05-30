'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Block dangerous schemes; allow http/https/mailto and bare domains.
  if (/^\s*javascript:/i.test(trimmed)) return null;
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed.startsWith('/') ? trimmed : `https://${trimmed}`;
}

export function EditorLinkPopover({
  initialHref,
  onApply,
  onRemove,
  onCancel,
}: {
  initialHref: string;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initialHref);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = () => {
    const href = normalizeHref(value);
    if (href) onApply(href);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1 bg-popover p-1 text-popover-foreground">
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        aria-label={t('editor.bubble.link')}
        placeholder={t('editor.link.placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-11 w-56 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      />
      <button
        type="button"
        aria-label={t('editor.link.apply')}
        title={t('editor.link.apply')}
        onClick={apply}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        ↵
      </button>
      {initialHref ? (
        <button
          type="button"
          aria-label={t('editor.link.remove')}
          title={t('editor.link.remove')}
          onClick={onRemove}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-destructive text-sm hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
