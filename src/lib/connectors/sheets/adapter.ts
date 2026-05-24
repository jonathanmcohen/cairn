import { google, type sheets_v4 } from 'googleapis';
import { z } from 'zod';
import type {
  AckedChange,
  ConnectorAdapter,
  ConnectorState,
  Diff,
  ExternalRow,
} from '@/lib/connectors/adapter';
import { loadAuthorizedClient, type SheetsAuthConfig } from './auth';

/**
 * Sheets adapter `sync_config` shape (stored in `database_connectors.sync_config`).
 *
 * - `spreadsheetId`: the Drive file id of the target spreadsheet.
 * - `sheetTitle`: the tab name; used as the A1-range prefix (`Sheet1!A2:C`).
 * - `headerRow`: 1-based row index of the header; data begins at headerRow+1.
 * - `columnMap`: Cairn property id → A1 column letter (`A`, `B`, `AA`, ...).
 * - `externalIdProperty`: which Cairn property holds the external row's stable id.
 * - `driveChannel`: Drive watch channel registration state (set by `subscribe`).
 */
export type SheetsSyncConfig = {
  spreadsheetId: string;
  sheetTitle: string;
  headerRow: number;
  columnMap: Record<string, string>;
  externalIdProperty: string;
  driveChannel?: {
    id: string;
    resourceId: string;
    token: string;
    expiration?: number | null;
  } | null;
};

const SheetsAuthConfigSchema = z.object({ refresh_token: z.string() });

function getCfg(state: ConnectorState): SheetsSyncConfig {
  return state.syncConfig as unknown as SheetsSyncConfig;
}

function sheetsClient(state: ConnectorState): sheets_v4.Sheets {
  const oauth = loadAuthorizedClient(state.authConfig as unknown as SheetsAuthConfig);
  return google.sheets({ version: 'v4', auth: oauth });
}

function driveClient(state: ConnectorState) {
  const oauth = loadAuthorizedClient(state.authConfig as unknown as SheetsAuthConfig);
  return google.drive({ version: 'v3', auth: oauth });
}

/** Convert an A1 column letter (`A`, `Z`, `AA`, `AZ`) to a 0-based index. */
export function colLetterToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') throw new Error(`Invalid column letter: ${letter}`);
    n = n * 26 + (ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return n - 1;
}

/** Convert a 0-based index back to A1 column letter (0→A, 26→AA). */
export function indexToColLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode('A'.charCodeAt(0) + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnsByProperty(cfg: SheetsSyncConfig): Array<[string, string]> {
  return Object.entries(cfg.columnMap);
}

function maxColumnLetter(cfg: SheetsSyncConfig): string {
  const cols = columnsByProperty(cfg);
  if (cols.length === 0) return 'A';
  let maxIdx = 0;
  for (const [, col] of cols) {
    const idx = colLetterToIndex(col);
    if (idx > maxIdx) maxIdx = idx;
  }
  return indexToColLetter(maxIdx);
}

/**
 * Build the A1 range covering the data area (firstDataRow → end) across all
 * mapped columns. Sheets accepts open-ended ranges like `Sheet1!A2:C`.
 */
function dataRange(cfg: SheetsSyncConfig): string {
  const firstDataRow = cfg.headerRow + 1;
  return `${cfg.sheetTitle}!A${firstDataRow}:${maxColumnLetter(cfg)}`;
}

export const SheetsAdapter: ConnectorAdapter = {
  kind: 'google_sheets',

  authConfigSchema: SheetsAuthConfigSchema,

  async fetchAll(state) {
    const cfg = getCfg(state);
    const client = sheetsClient(state);
    const firstDataRow = cfg.headerRow + 1;
    const range = dataRange(cfg);
    const { data } = await client.spreadsheets.values.batchGet({
      spreadsheetId: cfg.spreadsheetId,
      ranges: [range],
    });
    const rows = data.valueRanges?.[0]?.values ?? [];
    const props = columnsByProperty(cfg);

    const out: ExternalRow[] = [];
    rows.forEach((row: unknown[], idx: number) => {
      const cells: Record<string, unknown> = {};
      for (const [propId, colLetter] of props) {
        const colIndex = colLetterToIndex(colLetter);
        cells[propId] = row[colIndex] ?? null;
      }
      const sheetRowNumber = firstDataRow + idx;
      const candidateId = cells[cfg.externalIdProperty];
      const externalId =
        candidateId == null || candidateId === '' ? String(sheetRowNumber) : String(candidateId);
      out.push({ externalId, cells });
    });
    return out;
  },

  async applyChanges(state, diff: Diff) {
    const cfg = getCfg(state);
    const client = sheetsClient(state);
    const acks: AckedChange[] = [];

    // Resolve writable row numbers for updates by re-reading the externalId
    // column. Sheets' values API has no native row-by-id concept; this is the
    // cheapest correct path for a small spreadsheet (the only target this
    // adapter is shipped for in v0.7.0).
    const externalIdCol = cfg.columnMap[cfg.externalIdProperty];
    const externalIdColIdx = externalIdCol ? colLetterToIndex(externalIdCol) : null;
    let externalIdRows: Array<{ rowNumber: number; externalId: string }> = [];
    if (
      externalIdColIdx !== null &&
      (diff.updates.length > 0 || diff.deletes.length > 0)
    ) {
      const firstDataRow = cfg.headerRow + 1;
      const range = `${cfg.sheetTitle}!${externalIdCol}${firstDataRow}:${externalIdCol}`;
      const { data } = await client.spreadsheets.values.batchGet({
        spreadsheetId: cfg.spreadsheetId,
        ranges: [range],
      });
      const rows = data.valueRanges?.[0]?.values ?? [];
      externalIdRows = rows.map((r: unknown[], i: number) => ({
        rowNumber: firstDataRow + i,
        externalId: String(r[0] ?? firstDataRow + i),
      }));
    }

    const reqData: sheets_v4.Schema$ValueRange[] = [];

    // Updates: locate the row by externalId and overwrite all mapped cells.
    for (const up of diff.updates) {
      const match = externalIdRows.find((r) => r.externalId === up.externalId);
      if (!match) continue;
      const values = columnsByProperty(cfg).map(([propId]) =>
        up.cells[propId] === undefined ? '' : String(up.cells[propId] ?? ''),
      );
      reqData.push({
        range: `${cfg.sheetTitle}!A${match.rowNumber}:${maxColumnLetter(cfg)}${match.rowNumber}`,
        values: [values],
      });
      acks.push({ kind: 'update', externalId: up.externalId });
    }

    // Creates: append to the end of the data area. We use values.append via
    // batchUpdate-style by emitting one append per create; Sheets returns the
    // updatedRange so we can extract the new row number and synthesize an
    // externalId. For simplicity in P20, the external id is the row number —
    // the sync engine round-trips it back via the row-map on the next sync.
    for (const cr of diff.creates) {
      const values = columnsByProperty(cfg).map(([propId]) =>
        cr.cells[propId] === undefined ? '' : String(cr.cells[propId] ?? ''),
      );
      const res = await client.spreadsheets.values.append({
        spreadsheetId: cfg.spreadsheetId,
        range: `${cfg.sheetTitle}!A${cfg.headerRow + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] },
      });
      const updatedRange = res.data.updates?.updatedRange ?? '';
      // updatedRange looks like `Sheet1!A5:C5`; extract the trailing row number.
      const m = /(\d+)(?::|$)/.exec(updatedRange);
      const rowNumber = m ? Number(m[1]) : cfg.headerRow + 1;
      const externalId = String(rowNumber);
      acks.push({ kind: 'create', cairnRowId: cr.cairnRowId, externalId });
    }

    if (reqData.length > 0) {
      await client.spreadsheets.values.batchUpdate({
        spreadsheetId: cfg.spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: reqData },
      });
    }

    // Deletes: Sheets' values API has no row-delete; clear the row instead.
    // The sync engine drops the row-map entry on its side.
    for (const del of diff.deletes) {
      const match = externalIdRows.find((r) => r.externalId === del.externalId);
      if (!match) {
        acks.push({ kind: 'delete', externalId: del.externalId });
        continue;
      }
      await client.spreadsheets.values.clear({
        spreadsheetId: cfg.spreadsheetId,
        range: `${cfg.sheetTitle}!A${match.rowNumber}:${maxColumnLetter(cfg)}${match.rowNumber}`,
      });
      acks.push({ kind: 'delete', externalId: del.externalId });
    }

    return { acks };
  },

  async subscribe(state, _onChange) {
    const cfg = getCfg(state);
    const client = driveClient(state);
    const channelId = `cairn-conn-${state.connectorId}-${Date.now()}`;
    // Format: `${workspaceId}:${connectorId}` — the webhook recovers the pair
    // and validates cross-workspace access (404 on mismatch, mirroring the v0.5
    // P2 webhook + v0.6 sharing posture).
    const token = `${state.workspaceId ?? ''}:${state.connectorId}`;
    const webhookUrl = `${process.env.PUBLIC_URL ?? ''}/api/connectors/sheets/drive-webhook`;
    const { data } = await client.files.watch({
      fileId: cfg.spreadsheetId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token,
      },
    });
    const channelData: SheetsSyncConfig['driveChannel'] = {
      id: data.id ?? channelId,
      resourceId: data.resourceId ?? '',
      token,
      expiration: data.expiration ? Number(data.expiration) : null,
    };
    // Persist channel state on the connector row so the webhook can validate
    // + the operator can revoke. We mutate the in-memory state; the caller
    // is responsible for writing it back to `database_connectors.sync_config`.
    (state.syncConfig as Record<string, unknown>).driveChannel = channelData;

    return async () => {
      if (!channelData.id || !channelData.resourceId) return;
      try {
        await client.channels.stop({
          requestBody: { id: channelData.id, resourceId: channelData.resourceId },
        });
      } catch {
        // Channel may already be expired; ignore.
      }
    };
  },
};
