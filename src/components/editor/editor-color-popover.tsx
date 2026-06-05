'use client';

import type { Editor } from '@tiptap/react';
import { Palette } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

// #127 — small, fixed palette shared by text color and highlight. Text swatches
// use saturated mark hues; highlight swatches use the lighter tint of the same
// name so the two sections stay legible. Each entry carries a localized name key.
type Swatch = { key: string; text: string; highlight: string };

const SWATCHES: Swatch[] = [
  { key: 'editor.color.swatch.red', text: '#dc2626', highlight: '#fecaca' },
  { key: 'editor.color.swatch.orange', text: '#ea580c', highlight: '#fed7aa' },
  { key: 'editor.color.swatch.yellow', text: '#ca8a04', highlight: '#fde68a' },
  { key: 'editor.color.swatch.green', text: '#16a34a', highlight: '#bbf7d0' },
  { key: 'editor.color.swatch.blue', text: '#2563eb', highlight: '#bfdbfe' },
  { key: 'editor.color.swatch.purple', text: '#9333ea', highlight: '#e9d5ff' },
];

// Matches the bubble-menu BTN class so the trigger keeps the 44px touch floor.
const TRIGGER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

// Swatch cells: 44px touch floor with a centered color chip.
const SWATCH_BTN =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring';

const REMOVE_BTN =
  'mt-1 inline-flex min-h-11 w-full items-center rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring';

export function EditorColorPopover({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Yjs-safe: each handler is a standard ProseMirror transaction the
  // Collaboration extension syncs to Yjs.
  const applyText = (color: string) => {
    editor.chain().focus().setColor(color).run();
    setOpen(false);
  };
  const applyHighlight = (color: string) => {
    editor.chain().focus().setHighlight({ color }).run();
    setOpen(false);
  };
  const removeText = () => {
    editor.chain().focus().unsetColor().run();
  };
  const removeHighlight = () => {
    editor.chain().focus().unsetHighlight().run();
  };

  const colorActive = editor.isActive('textStyle') || editor.isActive('highlight');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={t('editor.bubble.color')}
        title={t('editor.bubble.color')}
        data-active={colorActive}
        className={cn(TRIGGER)}
      >
        <Palette className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex flex-col gap-2">
          <section aria-label={t('editor.bubble.color')}>
            <p className="mb-1 px-1 text-muted-foreground text-xs">{t('editor.bubble.color')}</p>
            <div className="grid grid-cols-6 gap-0.5">
              {SWATCHES.map((s) => (
                <button
                  key={`text-${s.key}`}
                  type="button"
                  aria-label={t(s.key)}
                  title={t(s.key)}
                  onClick={() => applyText(s.text)}
                  className={cn(SWATCH_BTN)}
                >
                  <span
                    className="size-5 rounded-full border border-border"
                    style={{ backgroundColor: s.text }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <button type="button" onClick={removeText} className={cn(REMOVE_BTN)}>
              {t('editor.color.removeText')}
            </button>
          </section>
          <section aria-label={t('editor.bubble.highlight')}>
            <p className="mb-1 px-1 text-muted-foreground text-xs">
              {t('editor.bubble.highlight')}
            </p>
            <div className="grid grid-cols-6 gap-0.5">
              {SWATCHES.map((s) => (
                <button
                  key={`hl-${s.key}`}
                  type="button"
                  aria-label={t(s.key)}
                  title={t(s.key)}
                  onClick={() => applyHighlight(s.highlight)}
                  className={cn(SWATCH_BTN)}
                >
                  <span
                    className="size-5 rounded-sm border border-border"
                    style={{ backgroundColor: s.highlight }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <button type="button" onClick={removeHighlight} className={cn(REMOVE_BTN)}>
              {t('editor.color.removeHighlight')}
            </button>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
