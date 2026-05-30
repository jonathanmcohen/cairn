'use client';

import { useState } from 'react';
import { SharePanel } from '@/components/pages/share-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/lib/i18n/provider';

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  slug: string | null;
  initialAllowDuplication?: boolean;
  initialHasPassword?: boolean;
  initialExpiresAt?: string | null;
};

export function ShareDialog({
  open,
  onOpenChange,
  pageId,
  slug,
  initialAllowDuplication,
  initialHasPassword,
  initialExpiresAt,
}: ShareDialogProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    if (!slug) return;
    const url = `${window.location.origin}/p/${slug}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
          <DialogDescription>{t('share.description')}</DialogDescription>
        </DialogHeader>

        {slug && (
          <div className="space-y-1">
            {/* The public path is a URL fragment, not translatable copy — render it
                as an expression so the i18n audit doesn't treat it as user copy. */}
            <div className="truncate text-muted-foreground text-sm">{`/p/${slug}`}</div>
            <Button type="button" variant="outline" size="sm" onClick={copyUrl}>
              {copied ? t('share.linkCopied') : t('share.copyLink')}
            </Button>
          </div>
        )}

        <SharePanel
          pageId={pageId}
          initialAllowDuplication={initialAllowDuplication}
          initialHasPassword={initialHasPassword}
          initialExpiresAt={initialExpiresAt}
        />
      </DialogContent>
    </Dialog>
  );
}
