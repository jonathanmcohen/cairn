'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/provider';
import { getShortcuts, type ShortcutScope } from '@/lib/shortcuts/registry';
import { useShortcutSheet } from './dispatcher';

const SCOPES: { scope: ShortcutScope; titleKey: string }[] = [
  { scope: 'global', titleKey: 'shortcuts.group.global' },
  { scope: 'editor', titleKey: 'shortcuts.group.editor' },
];

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

export function prettyKeys(keys: string): string {
  const mac = isMac();
  const parts = keys
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const rendered = parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === 'mod') return mac ? '⌘' : 'Ctrl';
    if (lower === 'shift') return mac ? '⇧' : 'Shift';
    if (lower === 'alt') return mac ? '⌥' : 'Alt';
    return part.toUpperCase();
  });
  return mac ? rendered.join('') : rendered.join('+');
}

export function ShortcutSheet() {
  const t = useT();
  const { open, setOpen } = useShortcutSheet();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
      <button
        type="button"
        aria-label={t('shortcuts.close')}
        className="fixed inset-0 bg-black/30"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('shortcuts.title')}</h2>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {SCOPES.map(({ scope, titleKey }) => {
            const entries = getShortcuts(scope);
            if (entries.length === 0) return null;
            return (
              <section key={scope} className="mb-4 last:mb-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(titleKey)}
                </h3>
                <ul className="space-y-1">
                  {entries.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
                      <span>{t(s.labelKey)}</span>
                      <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
                        {prettyKeys(s.keys)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
