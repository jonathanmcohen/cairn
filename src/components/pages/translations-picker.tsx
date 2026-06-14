'use client';

/**
 * G16 #163 — page translations picker.
 *
 * Lists pages linked to the same canonical (GET) and lets editors link this
 * page as a translation of another by entering the canonical page id + a
 * locale (POST). Read-only for viewers. Errors surface inline via a themed
 * alert — never a native dialog.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/provider';

type Translation = { id: string; title: string; locale: string | null };

export function TranslationsPicker({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [items, setItems] = useState<Translation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [canonical, setCanonical] = useState('');
  const [locale, setLocale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/translations`);
    if (!res.ok) return;
    const data = (await res.json()) as { translations: Translation[] };
    setItems(data.translations);
    setLoaded(true);
  }, [pageId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function link(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/translations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalPageId: canonical, locale }),
      });
      if (!res.ok) {
        setError(t('pages.translations.linkError'));
        return;
      }
      setCanonical('');
      setLocale('');
      await refetch();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // v0.10.3 Q-6 — a viewer with no linked translations sees nothing instead of
  // an always-present empty "Translations" section. Editors still get it (empty
  // state + link inputs) so they can add the first translation. Gate on `loaded`
  // so we don't flash-hide before the initial fetch resolves.
  if (loaded && !canEdit && items.length === 0) {
    return null;
  }

  return (
    <section aria-label={t('pages.translations.title')} className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('pages.translations.title')}
      </h3>
      {loaded && items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('pages.translations.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span className="truncate">{it.title || it.id.slice(0, 8)}</span>
              {it.locale && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                  {it.locale}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={canonical}
            onChange={(e) => setCanonical(e.target.value)}
            placeholder={t('pages.translations.canonicalPlaceholder')}
            aria-label={t('pages.translations.canonicalPlaceholder')}
            className="h-8 w-64 text-sm"
          />
          <Input
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            placeholder={t('pages.translations.localePlaceholder')}
            aria-label={t('pages.translations.localePlaceholder')}
            className="h-8 w-32 text-sm"
          />
          <Button size="sm" disabled={busy || !canonical || !locale} onClick={() => void link()}>
            {t('pages.translations.link')}
          </Button>
          {error && (
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
