'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Property = { id: string; name: string; type: string };

type Props = {
  connectorId: string;
  properties: Property[];
  initial?: {
    spreadsheetId?: string;
    sheetTitle?: string;
    headerRow?: number;
    columnMap?: Record<string, string>;
    externalIdProperty?: string;
  };
};

/**
 * Per-connector config form for the Google Sheets adapter. Lets an admin pick:
 *  - the spreadsheet by id (Drive file id, visible in the URL)
 *  - the sheet tab name + 1-based header row
 *  - one Cairn property → A1 column letter mapping
 *  - which property holds the external row id
 *
 * Posts the full `sync_config` jsonb to `PATCH /api/connectors/:id`
 * (the P19 endpoint). Sets `enabled: true` so the connector starts syncing.
 */
export function SheetsConfigForm({ connectorId, properties, initial }: Props) {
  const [spreadsheetId, setSpreadsheetId] = useState(initial?.spreadsheetId ?? '');
  const [sheetTitle, setSheetTitle] = useState(initial?.sheetTitle ?? 'Sheet1');
  const [headerRow, setHeaderRow] = useState(initial?.headerRow ?? 1);
  const [externalIdProperty, setExternalIdProperty] = useState(
    initial?.externalIdProperty ?? properties[0]?.id ?? '',
  );
  const [columnMap, setColumnMap] = useState<Record<string, string>>(initial?.columnMap ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setColumn(propId: string, col: string): void {
    const trimmed = col.trim().toUpperCase();
    setColumnMap((m) => ({ ...m, [propId]: trimmed }));
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
          syncConfig: { spreadsheetId, sheetTitle, headerRow, columnMap, externalIdProperty },
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
        <Label htmlFor="spreadsheetId">Spreadsheet ID</Label>
        <Input
          id="spreadsheetId"
          required
          value={spreadsheetId}
          onChange={(e) => setSpreadsheetId(e.target.value)}
          placeholder="1abc...xyz"
        />
        <p className="text-xs text-muted-foreground">
          The Drive file id — visible in the spreadsheet URL between <code>/d/</code> and{' '}
          <code>/edit</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="sheetTitle">Sheet tab name</Label>
          <Input
            id="sheetTitle"
            required
            value={sheetTitle}
            onChange={(e) => setSheetTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="headerRow">Header row (1-based)</Label>
          <Input
            id="headerRow"
            type="number"
            min={1}
            value={headerRow}
            onChange={(e) => setHeaderRow(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="externalIdProperty">External-ID property</Label>
        <select
          id="externalIdProperty"
          value={externalIdProperty}
          onChange={(e) => setExternalIdProperty(e.target.value)}
          className="w-full rounded border px-2 py-1"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Which Cairn property uniquely identifies a row across both systems.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Property → Column letter</Label>
        {properties.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-40 text-sm">{p.name}</span>
            <Input
              placeholder="A"
              value={columnMap[p.id] ?? ''}
              onChange={(e) => setColumn(p.id, e.target.value)}
              className="w-20"
              aria-label={`Column for ${p.name}`}
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
