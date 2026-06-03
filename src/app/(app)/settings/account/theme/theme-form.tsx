'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';
import {
  ACCENT_PRESETS,
  FONT_FAMILIES,
  type FontFamily,
  PAGE_WIDTHS,
  type PageWidth,
  type ThemePrefs,
} from '@/lib/themes/presets';

export type ThemeFormProps = { initial: ThemePrefs };

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ThemeForm({ initial }: ThemeFormProps) {
  const t = useT();
  const [accent, setAccent] = useState<string>(initial.accent);
  const [customHex, setCustomHex] = useState<string>(
    initial.accent.startsWith('#') ? initial.accent : '',
  );
  const [fontFamily, setFontFamily] = useState<FontFamily>(initial.fontFamily);
  const [pageWidth, setPageWidth] = useState<PageWidth>(initial.pageWidth);
  const [pending, startTransition] = useTransition();

  // J3 (#200) — scoped live preview. Inline --primary/--ring on the preview
  // container only override tokens for its descendants, so the preview button
  // recolors without touching the document root or persisting anything.
  const previewVars = useMemo<React.CSSProperties>(() => {
    const hex = customHex && HEX_RE.test(customHex) ? customHex : null;
    if (hex) return { ['--cairn-accent' as string]: hex };
    const preset = ACCENT_PRESETS.find((p) => p.id === accent);
    return preset
      ? { ['--primary' as string]: preset.primaryHsl, ['--ring' as string]: preset.primaryHsl }
      : {};
  }, [accent, customHex]);

  async function save() {
    const finalAccent = customHex && HEX_RE.test(customHex) ? customHex : accent;
    startTransition(async () => {
      const res = await fetch('/api/settings/theme', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent: finalAccent, fontFamily, pageWidth }),
      });
      if (res.ok) {
        toast.success('Theme saved');
        // Reload so the server-rendered <ThemeProvider> picks up the new prefs.
        window.location.reload();
      } else {
        toast.error('Could not save theme');
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      <fieldset className="space-y-2">
        <Label>Accent</Label>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setAccent(p.id);
                setCustomHex('');
              }}
              aria-label={p.label}
              aria-pressed={accent === p.id && !customHex}
              className={`h-11 w-11 rounded-full border-2 ${
                accent === p.id && !customHex ? 'border-foreground' : 'border-transparent'
              }`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
        <div
          data-testid="theme-preview"
          style={previewVars}
          className="mt-2 flex items-center gap-3 rounded-md border p-3"
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            {t('theme.preview.button')}
          </button>
          <span className="text-sm text-muted-foreground">{t('theme.preview.label')}</span>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Label htmlFor="custom-hex" className="w-24">
            Custom hex
          </Label>
          <Input
            id="custom-hex"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            placeholder="#abcdef"
            className="w-32"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <Label>Font family</Label>
        <div className="flex gap-2">
          {FONT_FAMILIES.map((f) => (
            <Button
              key={f}
              type="button"
              variant={fontFamily === f ? 'default' : 'outline'}
              onClick={() => setFontFamily(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <Label>Page width</Label>
        <div className="flex gap-2">
          {PAGE_WIDTHS.map((w) => (
            <Button
              key={w}
              type="button"
              variant={pageWidth === w ? 'default' : 'outline'}
              onClick={() => setPageWidth(w)}
            >
              {w}
            </Button>
          ))}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
