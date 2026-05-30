'use client';

import { useEffect, useRef, useState } from 'react';
import { formatIcon, parseIcon } from '@/lib/pages/icon-format';
import { CustomIconUpload } from './pages/custom-icon-upload';
import { Button } from './ui/button';

const RECENT_KEY = 'cairn:recent-emojis';
const RECENT_MAX = 16;

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeRecent(next: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_MAX)));
  } catch {
    /* quota / private mode */
  }
}

export type IconPickerProps = {
  /** Raw stored value (prefix-encoded or legacy). */
  value: string | null;
  /** Receives a prefix-encoded string ("emoji::🪨" / "file::<uuid>") or null to clear. */
  onChange: (next: string | null) => void;
};

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
  }, [open]);

  // Mount the emoji-picker web component when the emoji tab is active. Forward
  // the search prop into the component (it supports `.skinToneEmoji` + filter
  // via direct property assignment).
  useEffect(() => {
    if (!open || tab !== 'emoji') return;
    let cancelled = false;
    void import('emoji-picker-element').then(() => {
      if (cancelled || !containerRef.current) return;
      type PickerEl = HTMLElement & {
        dataSource?: string;
        addEventListener: (
          event: 'emoji-click',
          handler: (e: CustomEvent<{ unicode: string }>) => void,
        ) => void;
      };
      const picker = document.createElement('emoji-picker') as PickerEl;
      // Self-hosted dataset (public/emoji-data.json, copied from
      // emoji-picker-element-data at dev/build). Without this the component
      // fetches from the jsdelivr CDN, which Cairn's strict CSP
      // (`connect-src 'self'`) blocks — so the picker would never populate.
      picker.dataSource = '/emoji-data.json';
      picker.addEventListener('emoji-click', (e) => {
        const next = formatIcon({ kind: 'emoji', value: e.detail.unicode });
        const dedup = [e.detail.unicode, ...recent.filter((r) => r !== e.detail.unicode)];
        writeRecent(dedup);
        setRecent(dedup);
        onChange(next);
        setOpen(false);
      });
      containerRef.current.replaceChildren(picker);
    });
    return () => {
      cancelled = true;
    };
  }, [open, tab, onChange, recent]);

  const parsed = parseIcon(value);
  const buttonLabel =
    parsed?.kind === 'emoji' ? parsed.value : parsed?.kind === 'file' ? '🖼️' : '📄';

  return (
    <div className="relative inline-block">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change icon"
        className="h-10 w-10 text-3xl"
      >
        {buttonLabel}
      </Button>
      {open && (
        <div className="absolute left-0 z-10 mt-2 w-[360px] rounded-md border bg-background p-3 shadow-lg">
          <div className="mb-2 flex gap-2 border-b pb-2">
            <Button
              type="button"
              variant={tab === 'emoji' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTab('emoji')}
            >
              Emoji
            </Button>
            <Button
              type="button"
              variant={tab === 'upload' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTab('upload')}
            >
              Upload
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Remove
            </Button>
          </div>

          {tab === 'emoji' && (
            <>
              {recent.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 text-xs text-muted-foreground">Recently used</div>
                  <div className="flex flex-wrap gap-1">
                    {recent.slice(0, RECENT_MAX).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          const dedup = [r, ...recent.filter((x) => x !== r)];
                          writeRecent(dedup);
                          setRecent(dedup);
                          onChange(formatIcon({ kind: 'emoji', value: r }));
                          setOpen(false);
                        }}
                        className="rounded p-1 text-xl hover:bg-accent"
                        aria-label={`Use ${r}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* The emoji-picker-element web component renders its own internal
                 search box + scrollable grid into this mount point. */}
              <div ref={containerRef} data-testid="emoji-picker-mount" />
            </>
          )}

          {tab === 'upload' && (
            <CustomIconUpload
              onUploaded={(formatted) => {
                onChange(formatted);
                setOpen(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
