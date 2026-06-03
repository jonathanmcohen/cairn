'use client';

import {
  Activity,
  Copy,
  CopyPlus,
  Download,
  FilePlus2,
  FileUp,
  Globe,
  Link as LinkIcon,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageActivityFeed } from '@/components/pages/activity-feed';
import { SaveAsTemplateDialog } from '@/components/pages/save-as-template-dialog';
import { ShareDialog } from '@/components/pages/share-dialog';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const shareAllowed = useActionAllowed('share');
  const [published, setPublished] = useState(initialPublished);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);

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

  // When the publish-confirm dialog opens, fetch the non-mutating preview so the
  // user sees the resolved public URL before committing to Publish (#70/#249).
  useEffect(() => {
    if (!confirmPublishOpen) return;
    let cancelled = false;
    void fetch(`/api/pages/${pageId}/publish`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { url: string } | null) => {
        if (!cancelled && b) setPreviewUrl(`${window.location.origin}${b.url}`);
      });
    return () => {
      cancelled = true;
    };
  }, [confirmPublishOpen, pageId]);

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

  function copyInternalLink() {
    const url = `${window.location.origin}/pages/${pageId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }

  async function duplicate() {
    const res = await fetch(`/api/pages/${pageId}/duplicate`, { method: 'POST' });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    window.location.href = `/pages/${id}`;
  }

  async function moveToTrash() {
    const ok = await confirm({
      title: t('pageMenu.confirmTrash'),
      confirmLabel: t('pageMenu.moveToTrash'),
      variant: 'danger',
    });
    if (!ok) return;
    const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
    if (res.ok) window.location.href = '/';
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
              onClick={() => {
                setConfirmPublishOpen(true);
                setOpen(false);
              }}
              disabled={!shareAllowed}
              title={shareAllowed ? undefined : t('pageMenu.unavailableOffline')}
            >
              <Globe aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t('pageMenu.publish')}
            </button>
          ) : (
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
          )}
          {/* Share & permissions is available for every page (published or not):
              the dialog mounts the per-page ACL manager, which must be reachable
              for private pages too (#259). */}
          <button
            type="button"
            className={ITEM_CLASS}
            disabled={!shareAllowed}
            title={shareAllowed ? undefined : t('pageMenu.unavailableOffline')}
            onClick={() => {
              setShareOpen(true);
              setOpen(false);
            }}
          >
            <LinkIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('share.menuLabel')}
          </button>
          <div className="my-1 border-t" />
          {/* Export lives in the single action-bar Export menu (PageExportMenu)
              — the lone export surface (#56/#235). This hint row fires the same
              `cairn:export:open` event the ⌘⇧E shortcut does (#61/#240), opening
              that menu; it carries no duplicate format buttons of its own. */}
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cairn:export:open'));
              setOpen(false);
            }}
          >
            <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t('pageMenu.exportHint')}</span>
            <kbd className="ml-auto text-muted-foreground text-xs">⌘⇧E</kbd>
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
            onClick={() => {
              copyInternalLink();
            }}
          >
            <Copy aria-hidden="true" className="h-4 w-4 shrink-0" />
            {linkCopied ? t('pageMenu.linkCopied') : t('pageMenu.copyLink')}
          </button>
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              void duplicate();
            }}
          >
            <CopyPlus aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('pageMenu.duplicate')}
          </button>
          {/* TODO(move-to): follow-up — the "Move to…" (reparent) action needs a
              self-contained page-picker popover (reuse PageLinkList + fetchPages +
              a "Move to top level" option). That picker UX exceeds the ~30-line
              off-ramp threshold in the P19 plan, so it ships as a follow-up. The
              backend (POST /api/pages/[id]/move { newParentId }) already exists. */}
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              void moveToTrash();
            }}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('pageMenu.moveToTrash')}
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
      <Dialog
        open={confirmPublishOpen}
        onOpenChange={(next) => {
          setConfirmPublishOpen(next);
          if (!next) setPreviewUrl(null);
        }}
      >
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('publishConfirm.title')}</DialogTitle>
            <DialogDescription>{t('publishConfirm.body')}</DialogDescription>
          </DialogHeader>
          {previewUrl && (
            <div className="rounded-md border bg-muted/40 p-2">
              <div className="text-muted-foreground text-xs">{t('publishConfirm.urlLabel')}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-sm">{previewUrl}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(previewUrl).then(() => {
                      setPreviewCopied(true);
                      setTimeout(() => setPreviewCopied(false), 1500);
                    });
                  }}
                >
                  {previewCopied ? t('publishConfirm.urlCopied') : t('publishConfirm.copyUrl')}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmPublishOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmPublishOpen(false);
                void publish();
              }}
            >
              {t('publishConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        pageId={pageId}
        slug={slug}
        initialAllowDuplication={initialAllowDuplication}
        initialHasPassword={initialHasPassword}
        initialExpiresAt={initialExpiresAt}
      />
    </div>
  );
}
