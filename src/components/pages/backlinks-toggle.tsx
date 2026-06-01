'use client';

/**
 * G16 #163 — client toggle that mounts the (previously unreachable)
 * BacklinksPanel as a right-edge overlay. The page view is a server component,
 * so this small client wrapper owns the open/close state.
 */
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import { BacklinksPanel } from './backlinks-panel';

export function BacklinksToggle({ pageId }: { pageId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Link2 className="mr-1 h-4 w-4" aria-hidden />
        {t('pages.backlinks.toggle')}
      </Button>
      {open && (
        <div className="fixed inset-y-0 right-0 z-40">
          <BacklinksPanel pageId={pageId} open={open} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
