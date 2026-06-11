'use client';

import { useState } from 'react';
import { ForwarderForm } from '@/app/(app)/admin/siem/forwarder-form';
import { useT } from '@/lib/i18n/provider';

export type ForwarderRow = {
  id: string;
  kind: string;
  name: string;
  endpoint: string;
  enabled: boolean;
};

// v0.10.0 D1 — per-row test-fire result. `failure` carries the remote
// target's error string VERBATIM (the route does not scrub it), so the UI
// renders it collapsed-by-default and labeled as remote output — a secret
// echoed back by a misconfigured target must never auto-display.
type TestResult =
  | { kind: 'success' }
  | { kind: 'failure'; remoteError: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'requestFailed'; status: number | null };

// The s3 archive target has no live sender wired (`DEFAULT_SENDERS` covers
// http/syslog/splunk_hec/datadog); the test route answers 400 for it, so the
// button is disabled up-front with a tooltip — and the 400 is still handled
// defensively below in case a new kind ships without a sender.
const UNTESTABLE_KINDS = new Set(['s3']);

// Client view for the SIEM-forwarder settings page. The parent RSC fetches the
// forwarder rows and gates on requireRole('admin'); this renders the i18n copy
// (RSCs cannot call the useT() hook) and embeds the existing <ForwarderForm/>.
export function ForwardersView({ forwarders }: { forwarders: ForwarderRow[] }) {
  const t = useT();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, TestResult>>({});

  function setResult(id: string, result: TestResult): void {
    setResults((prev) => ({ ...prev, [id]: result }));
  }

  async function sendTest(forwarder: ForwarderRow): Promise<void> {
    setPending((prev) => ({ ...prev, [forwarder.id]: true }));
    setResults(({ [forwarder.id]: _dropped, ...rest }) => rest);
    try {
      const res = await fetch(`/api/admin/siem/${forwarder.id}/test`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      // ROUTE CONTRACT: a sender failure comes back as HTTP 200 with
      // {ok:false, error} — key off the BODY, not res.ok. Non-2xx means the
      // route itself refused (400 = no sender wired for this kind; 401/403/404
      // = auth or scoping).
      if (res.ok && body?.ok === true) {
        setResult(forwarder.id, { kind: 'success' });
      } else if (res.ok && body?.ok === false) {
        setResult(forwarder.id, { kind: 'failure', remoteError: body.error ?? '' });
      } else if (res.status === 400 && body?.error) {
        setResult(forwarder.id, { kind: 'unsupported', reason: body.error });
      } else {
        setResult(forwarder.id, { kind: 'requestFailed', status: res.status });
      }
    } catch {
      setResult(forwarder.id, { kind: 'requestFailed', status: null });
    } finally {
      setPending((prev) => ({ ...prev, [forwarder.id]: false }));
    }
  }

  function renderResult(result: TestResult): React.ReactNode {
    switch (result.kind) {
      case 'success':
        return (
          <p role="status" className="text-sm text-success" data-testid="siem-test-success">
            {t('settingsAdmin.siem.test.success')}
          </p>
        );
      case 'failure':
        return (
          <div data-testid="siem-test-failure">
            <p role="alert" className="text-sm text-destructive">
              {t('settingsAdmin.siem.test.failed')}
            </p>
            {result.remoteError ? (
              // Collapsed by default, on purpose: the error string is the
              // remote endpoint's output verbatim and may echo credentials.
              <details className="mt-2" data-testid="siem-test-remote-details">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t('settingsAdmin.siem.test.remoteSummary')}
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settingsAdmin.siem.test.remoteNote')}
                </p>
                <pre
                  className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 font-mono text-xs"
                  data-testid="siem-test-remote-error"
                >
                  {result.remoteError}
                </pre>
              </details>
            ) : null}
          </div>
        );
      case 'unsupported':
        return (
          <p
            role="alert"
            className="text-sm text-muted-foreground"
            data-testid="siem-test-unsupported"
          >
            {t('settingsAdmin.siem.test.unsupportedWithReason', { reason: result.reason })}
          </p>
        );
      case 'requestFailed':
        return (
          <p role="alert" className="text-sm text-destructive" data-testid="siem-test-error">
            {result.status === null
              ? t('settingsAdmin.siem.test.requestFailedNetwork')
              : t('settingsAdmin.siem.test.requestFailed', { status: result.status })}
          </p>
        );
    }
  }

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold">{t('settingsAdmin.siem.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('settingsAdmin.siem.description')}</p>
      </header>

      <section aria-labelledby="forwarders-list" className="space-y-4">
        <h2 id="forwarders-list" className="text-lg font-medium">
          {t('settingsAdmin.siem.configured')}
        </h2>
        {forwarders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settingsAdmin.siem.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {forwarders.map((f) => {
              const testable = !UNTESTABLE_KINDS.has(f.kind);
              const isPending = pending[f.id] === true;
              const result = results[f.id];
              return (
                <li
                  key={f.id}
                  className="rounded-md border p-4 text-sm"
                  data-testid="siem-forwarder-row"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium" title={f.name}>
                        {f.name} <span className="text-muted-foreground text-xs">({f.kind})</span>
                      </div>
                      <div className="truncate text-muted-foreground text-xs" title={f.endpoint}>
                        {f.endpoint}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-xs">
                        {f.enabled ? (
                          <span className="rounded bg-success/15 px-2 py-1 text-success">
                            {t('settingsAdmin.siem.enabled')}
                          </span>
                        ) : (
                          <span className="rounded bg-muted px-2 py-1">
                            {t('settingsAdmin.siem.disabled')}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void sendTest(f)}
                        disabled={isPending || !testable}
                        title={testable ? undefined : t('settingsAdmin.siem.test.unsupported')}
                        className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                        data-testid="siem-send-test"
                      >
                        {isPending
                          ? t('settingsAdmin.siem.test.sending')
                          : t('settingsAdmin.siem.test.button')}
                      </button>
                    </div>
                  </div>
                  {result ? <div className="mt-3 border-t pt-3">{renderResult(result)}</div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-forwarder" className="space-y-4">
        <h2 id="add-forwarder" className="text-lg font-medium">
          {t('settingsAdmin.siem.add')}
        </h2>
        <ForwarderForm />
      </section>
    </>
  );
}
