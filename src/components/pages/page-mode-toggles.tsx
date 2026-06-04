'use client';

import { Eye, Maximize2 } from 'lucide-react';
import { useEffect } from 'react';
import { ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import { prettyKeys, shortcutFor } from '@/lib/shortcuts/format';
import { usePageMode } from './page-mode-shell';

/**
 * Page-header toggle pair surfaced inside `<PageModeShell>`'s `toggles` slot.
 *
 * v0.9.0 G6 P33: two stand-alone toggles, not a single 3-state segmented
 * control — focus and reader are independently composable (a viewer can read a
 * doc with full chrome, or focus an editable doc without reader-mode).
 *
 * v0.9.4 #104: i18n'd labels + native-title tooltips, and a stronger pressed
 * state — the active toggle keeps the solid `default` variant AND gains a
 * focus-ring-colored 2px ring (driven by the `aria-pressed:` Tailwind variant)
 * so the on/off distinction is obvious at a glance (the prior `default` vs
 * `outline` swap alone read as too subtle). Ring + fill = redundant cues.
 *
 * a11y: both are `aria-pressed` toggle buttons with an explicit `aria-label`
 * (the accessible name) plus a `title` (the hover tooltip), and pad to 44x44
 * min to satisfy the WCAG 2.5.5 touch-target gate. The ring meets WCAG 1.4.11
 * non-text contrast for the state indicator.
 */
export function PageModeToggles() {
  const { focus, reader, setFocus, setReader } = usePageMode();
  const t = useT();
  // v0.9.9 Plan O #57/#236 — ensure the registry is populated so shortcutFor()
  // resolves even on a route where the shortcut dispatcher hasn't mounted yet.
  // ensureAppShortcuts() is idempotent.
  useEffect(() => {
    ensureAppShortcuts();
  }, []);
  // Append the rendered key glyph to each tooltip so the keyboard path is
  // discoverable (#57). prettyKeys() renders ⌘⇧. on mac / Ctrl+Shift+. elsewhere.
  const focusKeys = shortcutFor('page.focus');
  const readerKeys = shortcutFor('page.reader');
  const withKeys = (hint: string, keys: string | undefined) =>
    keys ? `${hint} (${prettyKeys(keys)})` : hint;
  // aria-pressed-driven ring: only paints when the button is pressed, so the
  // class can live statically on both toggles regardless of current state.
  const pressedRing =
    'aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-1 aria-pressed:ring-offset-background';
  return (
    <>
      <Button
        type="button"
        variant={focus ? 'default' : 'outline'}
        size="icon"
        aria-pressed={focus}
        aria-label={t('pageMode.focus')}
        title={withKeys(t('pageMode.focusHint'), focusKeys)}
        className={`min-h-[44px] min-w-[44px] ${pressedRing}`}
        onClick={() => setFocus(!focus)}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={reader ? 'default' : 'outline'}
        size="icon"
        aria-pressed={reader}
        aria-label={t('pageMode.reader')}
        title={withKeys(t('pageMode.readerHint'), readerKeys)}
        className={`min-h-[44px] min-w-[44px] ${pressedRing}`}
        onClick={() => setReader(!reader)}
      >
        <Eye className="h-4 w-4" />
      </Button>
    </>
  );
}
