import type { Locale } from './config';

export type Messages = Record<string, string>;

export type TParams = Record<string, string | number>;

export type TFunction = (key: string, params?: TParams) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, params: TParams | undefined): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function createT(locale: Locale, messages: Messages): TFunction {
  const pluralRules = new Intl.PluralRules(locale);
  return function t(key: string, params?: TParams): string {
    if (params && typeof params.count === 'number') {
      const category = pluralRules.select(params.count);
      const categoryKey = `${key}.${category}`;
      if (Object.hasOwn(messages, categoryKey)) {
        return interpolate(messages[categoryKey] as string, params);
      }
      const otherKey = `${key}.other`;
      if (Object.hasOwn(messages, otherKey)) {
        return interpolate(messages[otherKey] as string, params);
      }
      if (Object.hasOwn(messages, key)) {
        return interpolate(messages[key] as string, params);
      }
      return key;
    }
    if (Object.hasOwn(messages, key)) {
      return interpolate(messages[key] as string, params);
    }
    return key;
  };
}
