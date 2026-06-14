import { describe, expect, it } from 'vitest';
import {
  type WorkspaceReminderSetting,
  workspacesFireAtHour,
} from '@/lib/flashcards/notify-due-hour';

/**
 * v0.10.2 F3 Task D — per-workspace reminder send-hour selection.
 *
 * Pure unit tests: given a tick hour and a set of workspace settings, which
 * workspaces should send their digest this tick?
 *
 * Semantics chosen:
 *   - reminderHour = number → fires when tick hour matches.
 *   - reminderHour = null   → uses the DEFAULT_REMINDER_HOUR (9 UTC). This
 *     means "no per-workspace override" falls through to the global default
 *     rather than silently opting out, preserving backward compatibility.
 */
describe('workspacesFireAtHour', () => {
  const ws = (id: string, reminderHour: number | null): WorkspaceReminderSetting => ({
    workspaceId: id,
    reminderHour,
  });

  it('returns workspaces whose reminderHour matches the tick hour', () => {
    const settings = [ws('ws-a', 9), ws('ws-b', 14), ws('ws-c', 9)];
    const result = workspacesFireAtHour(settings, 9);
    expect(result.map((s) => s.workspaceId).sort()).toEqual(['ws-a', 'ws-c']);
  });

  it('returns empty array when no workspace matches the tick hour', () => {
    const settings = [ws('ws-a', 9), ws('ws-b', 14)];
    const result = workspacesFireAtHour(settings, 3);
    expect(result).toHaveLength(0);
  });

  it('workspaces with reminderHour=null fire at the default hour (9 UTC)', () => {
    const settings = [ws('ws-null', null), ws('ws-explicit', 9)];
    const result = workspacesFireAtHour(settings, 9);
    // Both should fire: null → default (9), and explicit 9.
    expect(result.map((s) => s.workspaceId).sort()).toEqual(['ws-explicit', 'ws-null']);
  });

  it('workspaces with reminderHour=null do NOT fire at non-default hours', () => {
    const settings = [ws('ws-null', null)];
    const result = workspacesFireAtHour(settings, 14);
    expect(result).toHaveLength(0);
  });

  it('handles empty settings list', () => {
    expect(workspacesFireAtHour([], 9)).toHaveLength(0);
  });

  it('handles tick hour = 0 (midnight)', () => {
    const settings = [ws('ws-midnight', 0), ws('ws-nine', 9)];
    const result = workspacesFireAtHour(settings, 0);
    expect(result.map((s) => s.workspaceId)).toEqual(['ws-midnight']);
  });

  it('handles tick hour = 23', () => {
    const settings = [ws('ws-late', 23)];
    const result = workspacesFireAtHour(settings, 23);
    expect(result.map((s) => s.workspaceId)).toEqual(['ws-late']);
  });

  it('all 24 hours are valid tick values (no off-by-one)', () => {
    const allHours = Array.from({ length: 24 }, (_, h) => ws(`ws-h${h}`, h));
    for (let h = 0; h < 24; h++) {
      const result = workspacesFireAtHour(allHours, h);
      expect(result.map((s) => s.workspaceId)).toEqual([`ws-h${h}`]);
    }
  });
});
