'use client';

import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/provider';

export function LocaleSwitcher() {
  const t = useT();
  const locale = useLocale();

  function setLocale(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* Standalone label: visible at sm+, hidden on narrow phones (#95). */}
      <span className="hidden text-muted-foreground sm:inline">{t('locale.label')}</span>
      <Select value={locale} onValueChange={(next) => setLocale(next as Locale)}>
        {/*
          Trigger keeps the accessible name at every breakpoint via aria-label,
          so SR users always hear "Language" even when the visible label/value
          text is collapsed. min-h-11 + min-w-11 guarantees a >=44px target in
          the icon-only state (WCAG 2.5.5). w-auto at sm+ so the full locale
          name can size the trigger naturally.
        */}
        <SelectTrigger
          aria-label={t('locale.label')}
          className="min-h-11 w-auto min-w-11 justify-center gap-1 px-2 sm:min-w-28 sm:justify-between sm:px-3"
        >
          {/* Globe affordance: only on narrow phones; decorative (aria-hidden). */}
          <Globe aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
          {/* Active-locale name: hidden on narrow phones, shown at sm+. */}
          <SelectValue className="hidden sm:block" />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((loc) => (
            <SelectItem key={loc} value={loc}>
              {t(`locale.${loc}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
