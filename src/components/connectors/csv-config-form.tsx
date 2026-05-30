'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Property = { id: string; name: string; type: string };

type Props = {
  connectorId: string;
  properties: Property[];
  initial?: {
    relativePath?: string;
    delimiter?: string;
    encoding?: string;
    columnMap?: Record<string, string>;
    externalIdProperty?: string;
  };
};

/**
 * Per-connector config form for the CSV adapter. Lets an admin:
 *  - set the relative file path under `CAIRN_CONNECTOR_CSV_PATH` (the mount)
 *  - pick the field delimiter (comma / semicolon / tab)
 *  - pick the encoding (utf8 / latin1 / utf16le)
 *  - choose which Cairn property is the external-id key
 *  - map each Cairn property → CSV column header (case-sensitive)
 *
 * No auth — CSV is a local-file connector. The mount itself is the
 * connection; the operator wires it via docker-compose volume + the
 * `CAIRN_CONNECTOR_CSV_PATH` env var. Path-traversal escapes are rejected
 * by the adapter at fetch/apply time.
 *
 * Posts to `PATCH /api/connectors/:id` (the P19 endpoint that persists
 * `sync_config`). `authConfig` is intentionally omitted from the payload.
 */
export function CsvConfigForm({ connectorId, properties, initial }: Props) {
  const [relativePath, setRelativePath] = useState(initial?.relativePath ?? '');
  const [delimiter, setDelimiter] = useState(initial?.delimiter ?? ',');
  const [encoding, setEncoding] = useState(initial?.encoding ?? 'utf8');
  const [externalIdProperty, setExternalIdProperty] = useState(
    initial?.externalIdProperty ?? properties[0]?.id ?? '',
  );
  const [columnMap, setColumnMap] = useState<Record<string, string>>(initial?.columnMap ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setHeader(propId: string, header: string): void {
    setColumnMap((m) => ({ ...m, [propId]: header.trim() }));
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          syncConfig: { relativePath, delimiter, encoding, columnMap, externalIdProperty },
          enabled: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
          error?: string;
        };
        setError(body.error ?? 'Save failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="relativePath">Relative file path (under mount)</Label>
        <Input
          id="relativePath"
          required
          value={relativePath}
          onChange={(e) => setRelativePath(e.target.value)}
          placeholder="projects.csv"
        />
        <p className="text-xs text-muted-foreground">
          Resolved under <code>CAIRN_CONNECTOR_CSV_PATH</code>. Paths that escape the mount are
          rejected at sync time.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="delimiter">Delimiter</Label>
          <Select value={delimiter} onValueChange={(next) => setDelimiter(next)}>
            <SelectTrigger id="delimiter" className="w-full" aria-label="Delimiter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">Comma (,)</SelectItem>
              <SelectItem value=";">Semicolon (;)</SelectItem>
              <SelectItem value="\t">Tab</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="encoding">Encoding</Label>
          <Select value={encoding} onValueChange={(next) => setEncoding(next)}>
            <SelectTrigger id="encoding" className="w-full" aria-label="Encoding">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="utf8">UTF-8</SelectItem>
              <SelectItem value="latin1">Latin-1 (ISO-8859-1)</SelectItem>
              <SelectItem value="utf16le">UTF-16 LE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="externalIdProperty">External-ID property</Label>
        <Select value={externalIdProperty} onValueChange={(next) => setExternalIdProperty(next)}>
          <SelectTrigger
            id="externalIdProperty"
            className="w-full"
            aria-label="External-ID property"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Which Cairn property uniquely identifies a row across both systems.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Property → CSV column header</Label>
        {properties.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-40 text-sm">{p.name}</span>
            <Input
              placeholder="Column header (case-sensitive)"
              value={columnMap[p.id] ?? ''}
              onChange={(e) => setHeader(p.id, e.target.value)}
              className="flex-1"
              aria-label={`Column header for ${p.name}`}
            />
          </div>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save connector'}
      </Button>
    </form>
  );
}
