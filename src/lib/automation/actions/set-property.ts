import { getDb } from '@/db/client';
import { updateCells } from '@/lib/databases/rows';
import { type ActionContext, BadConfigError } from './index';

/**
 * Set-property action. action_config = { databaseId, propertyId, value, rowId? }.
 * Falls back to payload.row.id when rowId is absent — typical use is "when a
 * row.created event fires, stamp a property on that same row".
 *
 * Wraps v0.5 `updateCells` which takes a cells map keyed by propertyId.
 * updateCells requires workspaceId — we use ctx.workspaceId for the access check.
 */
export async function runSetProperty(
  config: Record<string, unknown>,
  payload: unknown,
  ctx: ActionContext,
): Promise<void> {
  const databaseId = typeof config.databaseId === 'string' ? config.databaseId : null;
  const propertyId = typeof config.propertyId === 'string' ? config.propertyId : null;
  if (!databaseId || !propertyId) {
    throw new BadConfigError('set_property: databaseId + propertyId are required');
  }
  if (!('value' in config)) {
    throw new BadConfigError('set_property: value is required');
  }
  const explicitRow = typeof config.rowId === 'string' ? config.rowId : null;
  const fallbackRow =
    payload && typeof payload === 'object' && 'row' in payload
      ? ((payload as { row?: { id?: unknown } }).row?.id ?? null)
      : null;
  const rowId = explicitRow ?? (typeof fallbackRow === 'string' ? fallbackRow : null);
  if (!rowId) {
    throw new BadConfigError('set_property: rowId missing and payload.row.id unavailable');
  }

  await updateCells(getDb(), {
    databaseId,
    rowId,
    workspaceId: ctx.workspaceId,
    cells: { [propertyId]: config.value },
  });
}
