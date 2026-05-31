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
    baseId?: string;
    tableId?: string;
    fieldMap?: Record<string, string>;
    externalIdProperty?: string;
    /** Whether a PAT has already been stored — used to soften the input placeholder. */
    patPresent?: boolean;
  };
};

/**
 * Per-connector config form for the Airtable adapter. Lets an admin:
 *  - paste their Airtable Personal Access Token (encrypted on save by the server)
 *  - enter the base id (`appXXXXXXXX`) + table id (`tblXXXXXXXX`)
 *  - choose which Cairn property is the external-id key
 *  - map each Cairn property → Airtable field name (case-sensitive)
 *
 * Posts to `PATCH /api/connectors/:id` (the P19 endpoint that encrypts authConfig
 * and persists syncConfig). The PAT is never round-tripped through the UI: the
 * field clears on save and is left blank on load, even if a PAT is already
 * stored — admins re-paste to rotate.
 */
export function AirtableConfigForm({ connectorId, properties, initial }: Props) {
  const [pat, setPat] = useState('');
  const [baseId, setBaseId] = useState(initial?.baseId ?? '');
  const [tableId, setTableId] = useState(initial?.tableId ?? '');
  const [externalIdProperty, setExternalIdProperty] = useState(
    initial?.externalIdProperty ?? properties[0]?.id ?? '',
  );
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(initial?.fieldMap ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(propId: string, fieldName: string): void {
    setFieldMap((m) => ({ ...m, [propId]: fieldName }));
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Only send `authConfig` if the admin pasted a (new) PAT — otherwise leave
      // the existing encrypted token untouched. The server encrypts on save.
      const authConfig = pat ? { pat } : undefined;
      const res = await fetch(`/api/connectors/${connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          authConfig,
          syncConfig: { baseId, tableId, fieldMap, externalIdProperty },
          enabled: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
          error?: string;
        };
        setError(body.error ?? 'Save failed');
      } else {
        // Never round-trip the plaintext PAT through the UI after save.
        setPat('');
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
        <Label htmlFor="pat">Airtable Personal Access Token</Label>
        <Input
          id="pat"
          type="password"
          autoComplete="off"
          placeholder={initial?.patPresent ? '(unchanged)' : 'patXXXXXXXX…'}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Stored encrypted at rest. Leave blank to keep the existing token; paste a new value to
          rotate.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="baseId">Base ID</Label>
          <Input
            id="baseId"
            required
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            placeholder="appXXXXXXXX"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tableId">Table ID</Label>
          <Input
            id="tableId"
            required
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            placeholder="tblXXXXXXXX"
          />
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
        <Label>Property → Airtable field name</Label>
        {properties.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-40 text-sm">{p.name}</span>
            <Input
              placeholder="Field name (case-sensitive)"
              value={fieldMap[p.id] ?? ''}
              onChange={(e) => setField(p.id, e.target.value)}
              className="flex-1"
              aria-label={`Field name for ${p.name}`}
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
