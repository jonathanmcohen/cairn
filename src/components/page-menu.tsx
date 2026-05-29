'use client';

import {
  Activity,
  Download,
  FilePlus2,
  FileStack,
  FileUp,
  Globe,
  Link as LinkIcon,
  MoreHorizontal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageActivityFeed } from '@/components/pages/activity-feed';
import { SaveAsTemplateDialog } from '@/components/pages/save-as-template-dialog';
import { SharePanel } from '@/components/pages/share-panel';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50';

type PageMenuProps = {
  pageId: string;
  initialPublished?: boolean;
  initialSlug?: string | null;
  pageTitle?: string;
  initialAllowDuplication?: boolean;
  initialHasPassword?: boolean;
  initialExpiresAt?: string | null;
};

export function PageMenu({
  pageId,
  initialPublished = false,
  initialSlug = null,
  pageTitle = '',
  initialAllowDuplication = false,
  initialHasPassword = false,
  initialExpiresAt = null,
}: PageMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shareAllowed = useActionAllowed('share');
  const [published, setPublished] = useState(initialPublished);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [copied, setCopied] = useState(false);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);

  // Treat the popover as a non-modal dialog: keyboard users dismiss via Esc
  // (focus is restored to the trigger) and the surface carries an accessible
  // name. The surface contains a form (SharePanel) so `role="dialog"` is more
  // accurate than `role="menu"`. We don't trap focus or render a backdrop —
  // this is a popover, not a true modal — but Esc + focus restoration give the
  // keyboard-operable behaviour the spec checks for.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(`page-menu-title-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function download(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.click();
  }

  async function importMd() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,text/markdown,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await fetch(`/api/pages/${pageId}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: text }),
      });
      window.location.reload();
    };
    input.click();
  }

  async function publish() {
    const res = await fetch(`/api/pages/${pageId}/publish`, { method: 'POST' });
    if (!res.ok) return;
    const body = (await res.json()) as { slug: string };
    setSlug(body.slug);
    setPublished(true);
  }

  async function unpublish() {
    const res = await fetch(`/api/pages/${pageId}/unpublish`, { method: 'POST' });
    if (!res.ok) return;
    setPublished(false);
  }

  function copyUrl() {
    if (!slug) return;
    const url = `${window.location.origin}/p/${slug}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label={t('pageMenu.trigger')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </Button>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: dialog surface; onMouseLeave is a close-on-exit convenience for pointer users (keyboard users dismiss via Esc, which is wired above and restores focus to the trigger)
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 z-10 mt-1 w-56 rounded-md border bg-popover py-1 shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          <h2 id={titleId} className="sr-only">
            Page actions
          </h2>
          {!published ? (
            <button
              type="button"
              className={ITEM_CLASS}
              onClick={() => void publish()}
              disabled={!shareAllowed}
              title={shareAllowed ? undefined : t('pageMenu.unavailableOffline')}
            >
              <Globe aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t('pageMenu.publish')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={ITEM_CLASS}
                onClick={() => void unpublish()}
                disabled={!shareAllowed}
                title={shareAllowed ? undefined : t('pageMenu.unavailableOffline')}
              >
                <Globe aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t('pageMenu.unpublish')}
              </button>
              <div className="px-3 py-1.5">
                <div className="text-muted-foreground mb-1 truncate text-xs">/p/{slug}</div>
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-2 text-xs underline hover:no-underline"
                  onClick={copyUrl}
                >
                  <LinkIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {copied ? t('pageMenu.copied') : t('pageMenu.copyPublicLink')}
                </button>
              </div>
              <div className="my-1 border-t" />
              <SharePanel
                pageId={pageId}
                initialAllowDuplication={initialAllowDuplication}
                initialHasPassword={initialHasPassword}
                initialExpiresAt={initialExpiresAt}
              />
            </>
          )}
          <div className="my-1 border-t" />
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              download(`/api/pages/${pageId}/export`);
              setOpen(false);
            }}
          >
            <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('pageMenu.exportMd')}
          </button>
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              download(`/api/pages/${pageId}/export?recursive=true`);
              setOpen(false);
            }}
          >
            <FileStack aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('pageMenu.exportZip')}
          </button>
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              void importMd();
              setOpen(false);
            }}
          >
            <FileUp aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('pageMenu.importMd')}
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              setSaveTplOpen(true);
              setOpen(false);
            }}
          >
            <FilePlus2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            {savedAsTemplate ? t('pageMenu.savedTemplate') : t('pageMenu.saveTemplate')}
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            className={ITEM_CLASS}
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen((v) => !v)}
          >
            <Activity aria-hidden="true" className="h-4 w-4 shrink-0" />
            {activityOpen ? t('pageMenu.hideActivity') : t('pageMenu.showActivity')}
          </button>
          {activityOpen ? (
            <div className="px-3 py-2">
              <PageActivityFeed pageId={pageId} />
            </div>
          ) : null}
        </div>
      )}
      <SaveAsTemplateDialog
        open={saveTplOpen}
        pageId={pageId}
        defaultName={pageTitle || 'Untitled'}
        onClose={() => setSaveTplOpen(false)}
        onSaved={() => {
          setSavedAsTemplate(true);
          setTimeout(() => setSavedAsTemplate(false), 2000);
        }}
      />
    </div>
  );
}
