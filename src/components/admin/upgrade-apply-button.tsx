'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.0 G8 P42 — admin "Apply upgrade now" client button.
 *
 * POSTs to `/api/admin/upgrade/apply` and reads the SSE stream into a local
 * log. The RSC page only crosses the boundary with the primitive `disabled`
 * prop; the button owns its own state machine. #169 — the irreversible restart
 * is gated behind a themed confirm dialog (no fire-on-first-click).
 */
export function UpgradeApplyButton({ disabled }: { disabled: boolean }): React.ReactElement {
  const t = useT();
  const confirm = useConfirm();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function onClick(): Promise<void> {
    const ok = await confirm({
      title: t('admin.upgrade.confirmTitle'),
      description: t('admin.upgrade.confirmBody'),
      confirmLabel: t('admin.upgrade.confirmCta'),
      variant: 'danger',
    });
    if (!ok) return;
    setRunning(true);
    setLog([]);
    let res: Response;
    try {
      res = await fetch('/api/admin/upgrade/apply', { method: 'POST' });
    } catch (err) {
      setLog([`error: ${(err as Error).message}`]);
      setRunning(false);
      return;
    }
    if (!res.ok || !res.body) {
      setLog((l) => [...l, `error: HTTP ${res.status}`]);
      setRunning(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      for (const ev of events) {
        const line = ev.replace(/^data:\s*/, '').trim();
        if (line) setLog((l) => [...l, line]);
      }
    }
    setRunning(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || running}
        className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {running ? 'Applying...' : 'Apply upgrade now'}
      </button>
      {log.length > 0 && (
        <pre className="mt-4 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
