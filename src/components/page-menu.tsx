'use client';

import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { SharePanel } from '@/components/pages/share-panel';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { Button } from '@/components/ui/button';

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
  const [open, setOpen] = useState(false);
  const shareAllowed = useActionAllowed('share');
  const [published, setPublished] = useState(initialPublished);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [copied, setCopied] = useState(false);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);

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

  async function saveAsTemplate() {
    const name = window.prompt('Template name', pageTitle || 'Untitled')?.trim();
    if (!name) return;
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'page', name, pageId }),
    });
    if (!res.ok) return;
    setSavedAsTemplate(true);
    setTimeout(() => setSavedAsTemplate(false), 2000);
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
      <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: presentational dropdown container; onMouseLeave is a close-on-exit convenience, the menu items below are real <button>s
        <div
          className="absolute right-0 z-10 mt-1 w-56 rounded-md border bg-popover py-1 shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          {!published ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
              onClick={() => void publish()}
              disabled={!shareAllowed}
              title={shareAllowed ? undefined : 'Unavailable offline'}
            >
              Publish to web
            </button>
          ) : (
            <>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                onClick={() => void unpublish()}
                disabled={!shareAllowed}
                title={shareAllowed ? undefined : 'Unavailable offline'}
              >
                Unpublish
              </button>
              <div className="px-3 py-1.5">
                <div className="text-muted-foreground mb-1 truncate text-xs">/p/{slug}</div>
                <button
                  type="button"
                  className="text-xs underline hover:no-underline"
                  onClick={copyUrl}
                >
                  {copied ? 'Copied!' : 'Copy public link'}
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
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              download(`/api/pages/${pageId}/export`);
              setOpen(false);
            }}
          >
            Export as .md
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              download(`/api/pages/${pageId}/export?recursive=true`);
              setOpen(false);
            }}
          >
            Export subtree as .zip
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              void importMd();
              setOpen(false);
            }}
          >
            Import markdown…
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => void saveAsTemplate()}
          >
            {savedAsTemplate ? 'Saved to templates' : 'Save as template…'}
          </button>
        </div>
      )}
    </div>
  );
}
