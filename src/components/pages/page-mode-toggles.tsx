'use client';

import { Eye, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageMode } from './page-mode-shell';

/**
 * Page-header toggle pair surfaced inside `<PageModeShell>`'s `toggles` slot.
 *
 * v0.9.0 G6 P33: two stand-alone toggles, not a single 3-state segmented
 * control — focus and reader are independently composable (a viewer can read a
 * doc with full chrome, or focus an editable doc without reader-mode).
 *
 * a11y: both buttons are `aria-pressed` toggle buttons and pad to 44x44 min
 * to satisfy the WCAG touch-target gate from the v0.6 a11y sweep.
 */
export function PageModeToggles() {
  const { focus, reader, setFocus, setReader } = usePageMode();
  return (
    <>
      <Button
        type="button"
        variant={focus ? 'default' : 'outline'}
        size="icon"
        aria-pressed={focus}
        aria-label="Focus mode"
        title="Focus mode (hide sidebar + header + comments)"
        className="min-h-[44px] min-w-[44px]"
        onClick={() => setFocus(!focus)}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={reader ? 'default' : 'outline'}
        size="icon"
        aria-pressed={reader}
        aria-label="Reader mode"
        title="Reader mode (read-only prose view)"
        className="min-h-[44px] min-w-[44px]"
        onClick={() => setReader(!reader)}
      >
        <Eye className="h-4 w-4" />
      </Button>
    </>
  );
}
