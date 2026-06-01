'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFocusTrap } from '@/lib/a11y/focus-trap';
import { meetsAA } from '@/lib/color/contrast';
import { resolveTitleForeground } from '@/lib/color/title-contrast';
import { useT } from '@/lib/i18n/provider';
import type { PageCover } from '@/lib/pages/cover';
import { COVER_PRESETS, DEFAULT_COVER_PRESET_KEY } from '@/lib/pages/cover-presets';
import { UnsplashTab } from './cover-picker-unsplash-tab';

// The page title overlays/sits-below the cover on the theme `--foreground`
// token. Finding C: resolve the REAL computed token (light vs dark differ)
// rather than hardcoding `#fafafa`, then warn when the custom-hex cover fails
// AA against that actual color.

type TabKey = 'color' | 'unsplash' | 'url' | 'upload';

export type CoverPickerProps = {
  pageId: string;
  current: PageCover;
  /** Build-time inlined; undefined when the operator did not set the env. */
  unsplashKey?: string;
  /**
   * Optional. Server components mount the picker without a callback —
   * Next.js forbids passing functions from RSC → Client Component, so we
   * fall back to `router.refresh()` to re-fetch the cover. Only Client
   * Components with optimistic local state need to pass a function.
   */
  onChange?: (cover: PageCover) => void;
};

export function CoverPicker({ pageId, current, unsplashKey, onChange }: CoverPickerProps) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // #169 — trap Tab + handle Escape while the custom modal is open.
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const [tab, setTab] = useState<TabKey>('color');
  const [customHex, setCustomHex] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [titleColor, setTitleColor] = useState('#fafafa');

  // Read the live `--foreground` token once the modal mounts (client-only).
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const computed = getComputedStyle(document.documentElement).getPropertyValue('--foreground');
    setTitleColor(resolveTitleForeground(computed));
  }, [open]);

  async function persist(next: PageCover) {
    const res = await fetch(`/api/pages/${pageId}/cover`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      if (onChange) onChange(next);
      else router.refresh();
      setOpen(false);
    }
  }

  async function save(next: PageCover) {
    if (saving) return;
    setSaving(true);
    try {
      await persist(next);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    if (saving) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: form });
      if (!res.ok) return;
      const json = (await res.json()) as { id: string };
      await persist({ kind: 'upload', value: json.id });
    } finally {
      setSaving(false);
    }
  }

  const tabBtn = (key: TabKey, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      aria-selected={tab === key}
      role="tab"
      className={
        tab === key
          ? 'border-b-2 border-foreground px-3 py-1.5 text-sm font-medium'
          : 'border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
      }
    >
      {label}
    </button>
  );

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11"
        disabled={saving}
        onClick={() => setOpen(true)}
      >
        {saving ? (
          <Loader2
            aria-hidden="true"
            className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {'kind' in current ? t('cover.change') : t('cover.add')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
          <button
            type="button"
            aria-label={t('cover.close')}
            className="fixed inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div
            ref={trapRef}
            role="dialog"
            aria-label={t('cover.dialogTitle')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
            tabIndex={-1}
            className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
          >
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-medium">{t('cover.dialogTitle')}</h2>
            </div>
            <div className="px-4 pt-2">
              <div role="tablist" className="flex gap-1 border-b">
                {tabBtn('color', t('cover.tab.color'))}
                {unsplashKey && tabBtn('unsplash', t('cover.tab.unsplash'))}
                {tabBtn('url', t('cover.tab.url'))}
                {tabBtn('upload', t('cover.tab.upload'))}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {tab === 'color' && (
                <div className="space-y-4">
                  <Button
                    type="button"
                    className="w-full"
                    disabled={saving}
                    onClick={() => void save({ kind: 'preset', value: DEFAULT_COVER_PRESET_KEY })}
                  >
                    {t('cover.useDefault')}
                  </Button>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('cover.section.gradients')}
                    </p>
                    <div className="grid grid-cols-7 gap-2">
                      {COVER_PRESETS.filter((p) => p.type === 'gradient').map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className="h-10 w-full rounded border-2 border-transparent hover:border-foreground disabled:opacity-40"
                          style={{ backgroundImage: p.css }}
                          disabled={saving}
                          onClick={() => void save({ kind: 'preset', value: p.key })}
                          aria-label={t('cover.usePreset', { name: t(p.nameKey) })}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('cover.section.neutrals')}
                    </p>
                    <div className="grid grid-cols-7 gap-2">
                      {COVER_PRESETS.filter((p) => p.type === 'neutral').map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className="h-10 w-full rounded border-2 border-transparent hover:border-foreground disabled:opacity-40"
                          style={{ backgroundColor: p.css }}
                          disabled={saving}
                          onClick={() => void save({ kind: 'preset', value: p.key })}
                          aria-label={t('cover.usePreset', { name: t(p.nameKey) })}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="cover-hex" className="w-24">
                        {t('cover.customHex')}
                      </Label>
                      <Input
                        id="cover-hex"
                        value={customHex}
                        onChange={(e) => setCustomHex(e.target.value)}
                        placeholder="#abcdef"
                        className="w-32"
                      />
                      <Button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(customHex)) {
                            void save({ kind: 'color', value: customHex });
                          }
                        }}
                      >
                        {t('cover.use')}
                      </Button>
                    </div>
                    {/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(customHex) &&
                      !meetsAA(titleColor, customHex) && (
                        <p role="alert" className="text-xs text-destructive">
                          {t('cover.contrastWarning')}
                        </p>
                      )}
                  </div>
                  {'kind' in current && (
                    <Button variant="outline" disabled={saving} onClick={() => void save({})}>
                      {t('cover.remove')}
                    </Button>
                  )}
                </div>
              )}
              {tab === 'unsplash' && unsplashKey && (
                <UnsplashTab
                  accessKey={unsplashKey}
                  onPick={(url) => void save({ kind: 'unsplash', value: url })}
                />
              )}
              {tab === 'url' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cover-url">{t('cover.urlLabel')}</Label>
                    <Input
                      id="cover-url"
                      type="url"
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder={t('cover.urlPlaceholder')}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (/^https:\/\/\S+$/.test(coverUrl.trim())) {
                        void save({ kind: 'unsplash', value: coverUrl.trim() });
                      }
                    }}
                  >
                    {t('cover.use')}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t('cover.urlHint')}</p>
                </div>
              )}
              {tab === 'upload' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={saving}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t('cover.uploadHint')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
