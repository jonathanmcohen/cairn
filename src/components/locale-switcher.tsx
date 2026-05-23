'use client';

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
    <label className="flex items-center gap-2 text-sm">
      <span>{t('locale.label')}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="rounded border bg-background px-2 py-1 text-sm"
      >
        {LOCALES.map((loc) => (
          <option key={loc} value={loc}>
            {t(`locale.${loc}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
