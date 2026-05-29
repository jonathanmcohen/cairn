'use client';

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
      <span className="text-muted-foreground">{t('locale.label')}</span>
      <Select value={locale} onValueChange={(next) => setLocale(next as Locale)}>
        <SelectTrigger aria-label={t('locale.label')} className="min-h-11 w-auto min-w-28">
          <SelectValue />
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
