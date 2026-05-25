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
        // WCAG 2.5.5: enforce ≥44×44 touch target on the locale picker.
        className="min-h-11 min-w-11 rounded border bg-background px-3 py-2 text-sm"
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
