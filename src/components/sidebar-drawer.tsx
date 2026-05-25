'use client';

import { Menu, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useFocusTrap } from '@/lib/a11y/focus-trap';
import { Button } from './ui/button';

/**
 * Mobile (< md) navigation: a hamburger top bar that opens an off-canvas,
 * focus-trapped drawer holding the same `SidebarContent` as the desktop aside.
 * Both the bar and the drawer are hidden at `md` and up, where the desktop
 * `<aside>` takes over.
 */
export function SidebarDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <div className="flex items-center gap-2 border-b bg-card p-2 text-card-foreground md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          // WCAG 2.5.5: enforce a 44×44 touch target on the mobile drawer trigger.
          className="h-11 w-11"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {open && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a click-to-dismiss overlay; Escape handles keyboard dismissal and focus is trapped in the dialog */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is click-to-dismiss only; keyboard users dismiss the focus-trapped dialog with Escape */}
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card text-card-foreground shadow-lg md:hidden"
          >
            <div className="flex justify-end p-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                // WCAG 2.5.5: enforce a 44×44 touch target on the drawer close button.
                className="h-11 w-11"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">{children}</div>
          </div>
        </>
      )}
    </>
  );
}
