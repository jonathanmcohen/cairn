import type { PropertyType } from '@/db/schema';
import type { TFunction } from '@/lib/i18n/t';

/**
 * v0.9.9 Plan F2 (#242) — resolve a property type's human-readable, Title-Case
 * label via i18n (`database.propertyType.<type>`), instead of leaking the raw
 * lowercase/underscored enum value (`multi_select`) into the UI.
 */
export function propTypeLabel(type: PropertyType, t: TFunction): string {
  return t(`database.propertyType.${type}`);
}
