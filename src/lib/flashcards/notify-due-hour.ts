/**
 * v0.10.2 F3 Task D — per-workspace reminder send-hour selection.
 *
 * Pure, db-free helper so it is trivially unit-testable without Testcontainers.
 * The cron tick calls this with the current UTC hour and the list of workspace
 * settings to determine which workspaces fire their digest this tick.
 *
 * Semantics:
 *   - reminderHour = 0..23 → workspace fires when tick hour matches exactly.
 *   - reminderHour = null  → workspace uses DEFAULT_REMINDER_HOUR (9 UTC),
 *     which is the global default that existed before per-workspace overrides
 *     were introduced. This preserves backward compatibility: a workspace
 *     that has never configured a reminder still gets daily digests at 09:00
 *     UTC rather than being silently opted out.
 *
 * SMTP guard: the cron caller (notify-due-cli.ts) already checks emailEnabled()
 * before invoking the scan and short-circuits when SMTP is not configured.
 * This helper is pure and does NOT re-check SMTP — the caller is responsible.
 */

/** The UTC hour used for workspaces whose reminderHour is null. */
export const DEFAULT_REMINDER_HOUR = 9;

export type WorkspaceReminderSetting = {
  workspaceId: string;
  reminderHour: number | null;
};

/**
 * Given the current tick hour (UTC, 0–23) and a list of per-workspace
 * reminder settings, return only the workspaces that should fire this tick.
 */
export function workspacesFireAtHour(
  settings: WorkspaceReminderSetting[],
  tickHour: number,
): WorkspaceReminderSetting[] {
  return settings.filter((s) => (s.reminderHour ?? DEFAULT_REMINDER_HOUR) === tickHour);
}
