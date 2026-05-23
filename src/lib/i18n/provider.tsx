'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { Locale } from './config';
import { createT, type Messages, type TFunction } from './t';

type I18nContextValue = {
  locale: Locale;
  t: TFunction;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export type I18nProviderProps = {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
};

export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: createT(locale, messages) }),
    [locale, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useT/useLocale must be used inside <I18nProvider>');
  }
  return ctx;
}

export function useT(): TFunction {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}
