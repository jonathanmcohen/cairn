'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  applySidebarDensity,
  getSidebarDensity,
  type SidebarDensity,
  setSidebarDensity,
} from '@/components/sidebar/density-tokens';
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
  // J4 (#201) — split "user-typed hex" from "displayed hex". `customHex` holds
  // what the user has typed; `hexEdited` flags whether they've actually touched
  // the field. When un-edited, the input shows the active preset's hex so it is
  // never blank, but on save an un-edited prefill still persists as the preset.
  const [customHex, setCustomHex] = useState<string>(
    initial.accent.startsWith('#') ? initial.accent : '',
  );
  const [hexEdited, setHexEdited] = useState<boolean>(initial.accent.startsWith('#'));
  const [fontFamily, setFontFamily] = useState<FontFamily>(initial.fontFamily);
  const [pageWidth, setPageWidth] = useState<PageWidth>(initial.pageWidth);
  // S2 — sidebar density is a PER-DEVICE preference (localStorage, mirroring
  // the S1 sidebar-width precedent), unlike accent/font/width which persist
  // server-side via /api/settings/theme. It applies immediately on selection —
  // no Save round-trip — so it deliberately stays out of save() below.
  // SSR renders 'comfortable'; the mount effect syncs the persisted value.
  const [density, setDensityState] = useState<SidebarDensity>('comfortable');
  useEffect(() => {
    setDensityState(getSidebarDensity());
  }, []);
  const [pending, startTransition] = useTransition();

  const activePresetHex = ACCENT_PRESETS.find((p) => p.id === accent)?.hex ?? '';
  const hexValue = hexEdited ? customHex : activePresetHex;

  // J3 (#200) — scoped live preview. Inline --primary/--ring on the preview
  // container only override tokens for its descendants, so the preview button
  // recolors without touching the document root or persisting anything.
  const previewVars = useMemo<React.CSSProperties>(() => {
    const hex = hexEdited && HEX_RE.test(customHex) ? customHex : null;
    if (hex) return { ['--cairn-accent' as string]: hex };
    const preset = ACCENT_PRESETS.find((p) => p.id === accent);
    return preset
      ? { ['--primary' as string]: preset.primaryHsl, ['--ring' as string]: preset.primaryHsl }
      : {};
  }, [accent, customHex, hexEdited]);

  async function save() {
    // J4 — only treat the hex as a custom accent when the user edited it to
    // something different from the active preset's prefill; otherwise persist
    // the named preset id so its data-accent CSS block keeps applying.
    const editedHex = hexEdited && HEX_RE.test(customHex) ? customHex : null;
    const finalAccent = editedHex && editedHex !== activePresetHex ? editedHex : accent;
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
                setHexEdited(false);
              }}
              aria-label={p.label}
              aria-pressed={accent === p.id && !hexEdited}
              className={`h-11 w-11 rounded-full border-2 ${
                accent === p.id && !hexEdited ? 'border-foreground' : 'border-transparent'
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
            value={hexValue}
            onChange={(e) => {
              setHexEdited(true);
              setCustomHex(e.target.value);
            }}
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

      <fieldset className="space-y-2">
        <Label>{t('theme.density.label')}</Label>
        <div className="flex gap-2">
          {(['comfortable', 'compact'] as const).map((d) => (
            <Button
              key={d}
              type="button"
              data-testid={`density-${d}`}
              variant={density === d ? 'default' : 'outline'}
              onClick={() => {
                setDensityState(d);
                setSidebarDensity(d);
                applySidebarDensity(d);
              }}
            >
              {t(`theme.density.${d}`)}
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
