'use client';

import { PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

function setReveal(on: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-reveal-sidebar', on ? 'true' : 'false');
}

/**
 * v0.9.9 Plan O #59/#238 — left-edge hover strip + pin toggle that reveals the
 * focus-mode-hidden sidebar without exiting focus mode. Hover reveals
 * transiently; the pin keeps it revealed. Mounted by <PageModeShell> only while
 * focus is on; clears the root attribute on unmount.
 */
export function SidebarHotEdge() {
  const t = useT();
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    setReveal(pinned);
    return () => setReveal(false);
  }, [pinned]);

  const onEnter = useCallback(() => setReveal(true), []);
  const onLeave = useCallback(() => {
    if (!pinned) setReveal(false);
  }, [pinned]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: decorative hover
          strip; aria-hidden, the pin button is the keyboard-reachable control */}
      <div
        data-sidebar-hot-edge=""
        aria-hidden="true"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="fixed inset-y-0 left-0 z-50 w-2"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-pressed={pinned}
        aria-label={t('pageMode.pinSidebar')}
        title={t('pageMode.revealSidebar')}
        onClick={() => setPinned((p) => !p)}
        className="fixed bottom-3 left-3 z-[60] min-h-[44px] min-w-[44px] shadow-lg"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </Button>
    </>
  );
}
