'use client';

import { Minimize2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.9 Plan O #58/#237 — escape hatch from focus mode. Focus mode hides the
 * header (and the in-header focus toggle) via `html.cairn-focus-mode`, so we
 * render this fixed control ONLY while focus is on. A one-shot banner appears
 * on entry then auto-dismisses; a small floating button persists. Escape also
 * exits. Rendered by <PageModeShell>, which owns the exit callback.
 */
export function ExitFocusControl({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [showBanner, setShowBanner] = useState(true);

  // One-shot banner: auto-hide after 4s, leaving the persistent button.
  useEffect(() => {
    const id = window.setTimeout(() => setShowBanner(false), 4000);
    return () => window.clearTimeout(id);
  }, []);

  // Escape exits focus mode outright (matches the single-open-panel Escape UX).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <>
      {showBanner && (
        <div
          role="status"
          aria-live="polite"
          className="-translate-x-1/2 fixed top-3 left-1/2 z-[60] flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg"
        >
          <span>{t('pageMode.focusBanner')}</span>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('pageMode.exitFocus')}
        title={t('pageMode.exitFocus')}
        onClick={onExit}
        className="fixed top-3 right-3 z-[60] min-h-[44px] min-w-[44px] shadow-lg"
      >
        <Minimize2 className="h-4 w-4" />
      </Button>
    </>
  );
}
