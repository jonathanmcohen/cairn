import arMessages from '../../../messages/ar.json' with { type: 'json' };
import enMessages from '../../../messages/en.json' with { type: 'json' };
import esMessages from '../../../messages/es.json' with { type: 'json' };
import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';
import type { Messages } from './t';

const CATALOGS: Record<Locale, Messages> = {
  en: enMessages as Messages,
  ar: arMessages as Messages,
  es: esMessages as Messages,
};

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
}
