'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/provider';
import { prettyKeys } from '@/lib/shortcuts/format';
import { getShortcuts, type ShortcutScope } from '@/lib/shortcuts/registry';
import { useShortcutSheet } from './dispatcher';

const SCOPES: { scope: ShortcutScope; titleKey: string }[] = [
  { scope: 'global', titleKey: 'shortcuts.group.global' },
  { scope: 'editor', titleKey: 'shortcuts.group.editor' },
];

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
            // v0.10.0 Plan E E1 — an action can have several bindings (the
            // sheet itself: Mod+/ AND bare `?`). Group registry entries that
            // share a labelKey into one row listing every trigger.
            const rows = new Map<string, { id: string; allKeys: string[] }>();
            for (const s of entries) {
              const row = rows.get(s.labelKey);
              if (row) row.allKeys.push(s.keys);
              else rows.set(s.labelKey, { id: s.id, allKeys: [s.keys] });
            }
            return (
              <section key={scope} className="mb-4 last:mb-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(titleKey)}
                </h3>
                <ul className="space-y-1">
                  {[...rows.entries()].map(([labelKey, row]) => (
                    <li key={row.id} className="flex items-center justify-between gap-4 text-sm">
                      <span>{t(labelKey)}</span>
                      <span className="flex items-center gap-1">
                        {row.allKeys.map((keys) => (
                          <kbd
                            key={keys}
                            className="rounded border bg-muted px-2 py-0.5 font-mono text-xs"
                          >
                            {prettyKeys(keys)}
                          </kbd>
                        ))}
                      </span>
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
