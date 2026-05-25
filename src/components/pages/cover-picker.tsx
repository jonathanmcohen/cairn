'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PageCover } from '@/lib/pages/cover';
import { UnsplashTab } from './cover-picker-unsplash-tab';

const COLOR_PRESETS = [
  '#0f172a',
  '#1f2937',
  '#374151',
  '#4b5563',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#a21caf',
  '#e11d48',
  '#ea580c',
  '#d97706',
  '#ca8a04',
  '#059669',
  '#0d9488',
  '#0891b2',
  '#475569',
] as const;

type TabKey = 'color' | 'unsplash' | 'upload';

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('color');
  const [customHex, setCustomHex] = useState('');

  async function save(next: PageCover) {
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

  async function upload(file: File) {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch('/api/files', { method: 'POST', body: form });
    if (!res.ok) return;
    const json = (await res.json()) as { id: string };
    void save({ kind: 'upload', value: json.id });
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
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {'kind' in current ? 'Change cover' : 'Add cover'}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
          <button
            type="button"
            aria-label="Close cover picker"
            className="fixed inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Page cover"
            className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
          >
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-medium">Page cover</h2>
            </div>
            <div className="px-4 pt-2">
              <div role="tablist" className="flex gap-1 border-b">
                {tabBtn('color', 'Color')}
                {unsplashKey && tabBtn('unsplash', 'Unsplash')}
                {tabBtn('upload', 'Upload')}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {tab === 'color' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-8 gap-2">
                    {COLOR_PRESETS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className="h-8 w-8 rounded border-2 border-transparent hover:border-foreground"
                        style={{ backgroundColor: hex }}
                        onClick={() => void save({ kind: 'color', value: hex })}
                        aria-label={`Use ${hex}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="cover-hex" className="w-24">
                      Custom hex
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
                      onClick={() => {
                        if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(customHex)) {
                          void save({ kind: 'color', value: customHex });
                        }
                      }}
                    >
                      Use
                    </Button>
                  </div>
                  {'kind' in current && (
                    <Button variant="outline" onClick={() => void save({})}>
                      Remove cover
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
              {tab === 'upload' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Images are stored locally and served through signed URLs.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
