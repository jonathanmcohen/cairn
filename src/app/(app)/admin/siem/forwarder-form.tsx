'use client';

/**
 * v0.9.0 G8 P39/P40 — SIEM forwarder create form (Client Component).
 *
 * Submits to `/api/admin/siem` (POST). Reloads the page on success so the
 * RSC re-renders the new row. P39 shipped syslog + http; P40 extends the kind
 * select with `splunk_hec | datadog | s3` and routes per-kind options into the
 * jsonb `options` blob.
 *
 * The credential-secret field doubles as the HEC token (Splunk), the
 * DD-API-KEY (Datadog), or the optional bearer token (HTTP). S3 forwarders
 * don't carry a per-forwarder credential — the S3 client reads
 * `S3_ACCESS_KEY` / `S3_SECRET_KEY` from the deployment env (same
 * configuration the v0.5 P5 file-storage adapter uses).
 *
 * Edit + delete + test interactions live on the page-level table; this form
 * covers the create path.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Kind = 'syslog' | 'http' | 'splunk_hec' | 'datadog' | 's3';

const KIND_LABELS: Record<Kind, string> = {
  http: 'HTTP webhook',
  syslog: 'Syslog (RFC 5424)',
  splunk_hec: 'Splunk HEC',
  datadog: 'Datadog Logs',
  s3: 'S3 NDJSON daily archive',
};

const ENDPOINT_PLACEHOLDER: Record<Kind, string> = {
  http: 'https://siem.example.com/cairn-hook',
  syslog: 'udp://127.0.0.1:514',
  splunk_hec: 'https://splunk.example.com:8088',
  datadog: 'https://http-intake.logs.datadoghq.com',
  s3: 's3://cairn-audit-bucket',
};

export function ForwarderForm() {
  const [kind, setKind] = useState<Kind>('http');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [credentialSecret, setCredentialSecret] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Per-kind option fields. They write into the `options` jsonb blob on submit
  // based on the active `kind`; nothing flows through state for inactive kinds.
  const [splunkSourcetype, setSplunkSourcetype] = useState('cairn:audit');
  const [splunkSource, setSplunkSource] = useState('cairn');
  const [datadogService, setDatadogService] = useState('cairn');
  const [datadogHostname, setDatadogHostname] = useState('cairn');
  const [datadogTags, setDatadogTags] = useState('');
  const [s3Prefix, setS3Prefix] = useState('cairn');

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buildOptions(): Record<string, unknown> {
    if (kind === 'splunk_hec') {
      return { sourcetype: splunkSourcetype || 'cairn:audit', source: splunkSource || 'cairn' };
    }
    if (kind === 'datadog') {
      const tags = datadogTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return {
        service: datadogService || 'cairn',
        hostname: datadogHostname || 'cairn',
        ...(tags.length > 0 ? { tags } : {}),
      };
    }
    if (kind === 's3') {
      return { prefix: s3Prefix || 'cairn' };
    }
    return {};
  }

  function submit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const body: Record<string, unknown> = {
        kind,
        name,
        endpoint,
        enabled,
        options: buildOptions(),
      };
      // S3 archives don't use a per-forwarder credential — the S3 client reads
      // from process env. Don't ship an empty string for the secret in that
      // case (the API rejects empty strings).
      if (kind !== 's3' && credentialSecret) body.credentialSecret = credentialSecret;
      const res = await fetch('/api/admin/siem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.text()) || res.statusText);
        return;
      }
      // Reload so the RSC re-renders the new row.
      window.location.reload();
    });
  }

  const credentialLabel =
    kind === 'splunk_hec'
      ? 'HEC token'
      : kind === 'datadog'
        ? 'Datadog API key'
        : kind === 's3'
          ? 'Credential (managed via env vars)'
          : 'Credential secret';

  const credentialHelp =
    kind === 'splunk_hec'
      ? 'Sent as Authorization: Splunk <token>. Stored server-side, never re-displayed.'
      : kind === 'datadog'
        ? 'Sent as DD-API-KEY: <key>. Stored server-side, never re-displayed.'
        : kind === 's3'
          ? 'S3 forwarders use S3_ACCESS_KEY + S3_SECRET_KEY env vars; no per-forwarder secret.'
          : kind === 'http'
            ? 'HTTP targets send this as Authorization: Bearer <value>. Stored server-side, never re-displayed.'
            : 'Optional. Stored server-side, never re-displayed.';

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <Label htmlFor="siem-kind">Kind</Label>
        <select
          id="siem-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="block min-h-11 w-full rounded border bg-background px-3"
          aria-describedby="siem-kind-help"
        >
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <p id="siem-kind-help" className="text-xs text-muted-foreground">
          Each kind speaks its native protocol: <code>splunk_hec</code> uses the HTTP Event
          Collector; <code>datadog</code> uses the Logs Intake API; <code>s3</code> uploads a
          gzipped NDJSON object per workspace per UTC day.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="siem-name">Name</Label>
        <Input
          id="siem-name"
          value={name}
          required
          minLength={1}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="siem-endpoint">Endpoint</Label>
        <Input
          id="siem-endpoint"
          value={endpoint}
          required
          placeholder={ENDPOINT_PLACEHOLDER[kind]}
          onChange={(e) => setEndpoint(e.target.value)}
          aria-describedby="siem-endpoint-help"
        />
        <p id="siem-endpoint-help" className="text-xs text-muted-foreground">
          {kind === 's3'
            ? 'Bucket URL — only the host is read. Configure access via the S3_* env vars.'
            : kind === 'splunk_hec'
              ? 'Base URL of the HEC collector. The /services/collector path is appended automatically.'
              : kind === 'datadog'
                ? 'Region-specific intake URL — /api/v2/logs is appended automatically.'
                : 'Full URL the audit event is POSTed to.'}
        </p>
      </div>

      {kind === 'splunk_hec' ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="siem-splunk-sourcetype">Sourcetype</Label>
            <Input
              id="siem-splunk-sourcetype"
              value={splunkSourcetype}
              onChange={(e) => setSplunkSourcetype(e.target.value)}
              placeholder="cairn:audit"
              aria-describedby="siem-splunk-sourcetype-help"
            />
            <p id="siem-splunk-sourcetype-help" className="text-xs text-muted-foreground">
              Splunk indexing classifier. Defaults to <code>cairn:audit</code>.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="siem-splunk-source">Source</Label>
            <Input
              id="siem-splunk-source"
              value={splunkSource}
              onChange={(e) => setSplunkSource(e.target.value)}
              placeholder="cairn"
            />
          </div>
        </>
      ) : null}

      {kind === 'datadog' ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="siem-dd-service">Service</Label>
            <Input
              id="siem-dd-service"
              value={datadogService}
              onChange={(e) => setDatadogService(e.target.value)}
              placeholder="cairn"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="siem-dd-hostname">Hostname</Label>
            <Input
              id="siem-dd-hostname"
              value={datadogHostname}
              onChange={(e) => setDatadogHostname(e.target.value)}
              placeholder="cairn"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="siem-dd-tags">Extra tags (comma-separated)</Label>
            <Input
              id="siem-dd-tags"
              value={datadogTags}
              onChange={(e) => setDatadogTags(e.target.value)}
              placeholder="env:prod,team:platform"
              aria-describedby="siem-dd-tags-help"
            />
            <p id="siem-dd-tags-help" className="text-xs text-muted-foreground">
              Joined into <code>ddtags</code> alongside the per-event{' '}
              <code>workspace:&lt;id&gt;</code> tag.
            </p>
          </div>
        </>
      ) : null}

      {kind === 's3' ? (
        <div className="space-y-1">
          <Label htmlFor="siem-s3-prefix">Object prefix</Label>
          <Input
            id="siem-s3-prefix"
            value={s3Prefix}
            onChange={(e) => setS3Prefix(e.target.value)}
            placeholder="cairn"
            aria-describedby="siem-s3-prefix-help"
          />
          <p id="siem-s3-prefix-help" className="text-xs text-muted-foreground">
            Object key shape:{' '}
            <code>&lt;prefix&gt;/&lt;workspaceId&gt;/audit/YYYY-MM-DD.ndjson.gz</code>.
          </p>
        </div>
      ) : null}

      {kind !== 's3' ? (
        <div className="space-y-1">
          <Label htmlFor="siem-credential">
            {credentialLabel}{' '}
            {kind === 'http' ? <span className="text-muted-foreground">(optional)</span> : null}
          </Label>
          <Input
            id="siem-credential"
            type="password"
            autoComplete="off"
            value={credentialSecret}
            onChange={(e) => setCredentialSecret(e.target.value)}
            required={kind === 'splunk_hec' || kind === 'datadog'}
          />
          <p className="text-xs text-muted-foreground">{credentialHelp}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{credentialHelp}</p>
      )}

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4"
        />
        Enabled
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? 'Saving…' : 'Add forwarder'}
      </Button>
    </form>
  );
}
