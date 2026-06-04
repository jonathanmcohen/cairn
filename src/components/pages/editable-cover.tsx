'use client';

import { useState } from 'react';
import { CoverBanner } from '@/components/pages/cover-banner';
import { CoverPicker } from '@/components/pages/cover-picker';
import { useT } from '@/lib/i18n/provider';
import type { PageCover } from '@/lib/pages/cover';

export type EditableCoverProps = {
  pageId: string;
  cover: PageCover;
  alt?: string;
  unsplashKey?: string;
};

/**
 * #239 — wraps the server-rendered cover banner in a full-bleed edit button so
 * clicking the cover opens the same canonical CoverPicker the "Change cover"
 * button drives. Renders nothing when there is no cover (the empty-state path
 * keeps the standalone "Add cover" button below).
 */
export function EditableCover({ pageId, cover, alt = '', unsplashKey }: EditableCoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!('kind' in cover)) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t('cover.editAria')}
        onClick={() => setOpen(true)}
        className="block w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CoverBanner cover={cover} alt={alt} />
      </button>
      <CoverPicker
        pageId={pageId}
        current={cover}
        unsplashKey={unsplashKey}
        open={open}
        onOpenChange={setOpen}
        hideTrigger
      />
    </>
  );
}
