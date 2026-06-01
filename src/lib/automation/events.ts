/**
 * Closed enum of automation trigger events. Mirrors v0.5 `WebhookEvent` so any
 * event a webhook can subscribe to can also fire an automation rule.
 *
 * This module is intentionally dependency-free (no DB, no Node built-ins) so it
 * is safe to import from Client Components (the visual builder canvas iterates
 * this tuple for the trigger dropdown). The dispatcher re-exports these for
 * existing server-side consumers.
 */
export const TRIGGER_EVENTS = [
  'page.created',
  'page.updated',
  'page.deleted',
  'row.created',
  'row.updated',
  'row.deleted',
  'comment.created',
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];
