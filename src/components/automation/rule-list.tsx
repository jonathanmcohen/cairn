'use client';

import { useState } from 'react';
import { RuleForm } from '@/components/automation/rule-form';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type * as schema from '@/db/schema';

export type RuleListRow = {
  id: string;
  name: string;
  triggerEvent: string;
  condition: schema.AutomationCondition;
  actionType: schema.AutomationActionType;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  lastStatus: schema.AutomationRunStatus | null;
  lastRunAt: string | null;
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function statusClass(status: string | null): string {
  if (status === 'success') return 'text-green-600 dark:text-green-400';
  if (status === 'failed') return 'text-destructive';
  if (status === 'condition_unmet') return 'text-muted-foreground';
  return 'text-muted-foreground';
}

export function RuleList({
  initialRules,
  canMutate,
}: {
  initialRules: RuleListRow[];
  canMutate: boolean;
}) {
  const confirm = useConfirm();
  const [rules, setRules] = useState<RuleListRow[]>(initialRules);
  const [editing, setEditing] = useState<RuleListRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setEnabled(rule: RuleListRow, enabled: boolean) {
    setTogglingId(rule.id);
    setError(null);
    try {
      const res = await fetch(`/api/automation/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Toggle failed (${res.status})`);
        return;
      }
      setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(rule: RuleListRow) {
    const ok = await confirm({
      title: `Delete rule "${rule.name}"? Run history will be removed too.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setDeletingId(rule.id);
    setError(null);
    try {
      const res = await fetch(`/api/automation/rules/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Delete failed (${res.status})`);
        return;
      }
      setRules((rs) => rs.filter((r) => r.id !== rule.id));
    } finally {
      setDeletingId(null);
    }
  }

  function handleSaved(saved: RuleListRow | null, mode: 'create' | 'edit') {
    if (mode === 'create') {
      setCreating(false);
      if (saved) setRules((rs) => [saved, ...rs]);
    } else {
      setEditing(null);
      if (saved) setRules((rs) => rs.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canMutate ? (
        <div className="flex justify-end">
          {creating ? null : (
            <Button
              type="button"
              onClick={() => setCreating(true)}
              // WCAG 2.5.5: enforce a 44px-tall touch target on the page CTA.
              className="min-h-11"
            >
              New rule
            </Button>
          )}
        </div>
      ) : null}

      {creating ? (
        <RuleForm mode="create" onClose={(saved) => handleSaved(saved, 'create')} />
      ) : null}

      {editing ? (
        <RuleForm mode="edit" rule={editing} onClose={(saved) => handleSaved(saved, 'edit')} />
      ) : null}

      {rules.length === 0 ? (
        <p className="text-muted-foreground">No automation rules yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {r.triggerEvent}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {r.actionType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.lastStatus ? (
                      <>
                        <span className={`font-medium ${statusClass(r.lastStatus)}`}>
                          {r.lastStatus}
                        </span>
                        <div className="text-muted-foreground">{fmtDate(r.lastRunAt)}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canMutate || togglingId === r.id}
                      onClick={() => void setEnabled(r, !r.enabled)}
                    >
                      {r.enabled ? 'On' : 'Off'}
                    </Button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canMutate ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(r)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === r.id}
                          onClick={() => void remove(r)}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
