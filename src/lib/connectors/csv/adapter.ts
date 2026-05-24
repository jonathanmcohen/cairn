import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import type {
  AckedChange,
  ConnectorAdapter,
  ConnectorState,
  Diff,
  ExternalRow,
} from '@/lib/connectors/adapter';

/**
 * CSV adapter — third concrete `ConnectorAdapter` (after Sheets in P20 and
 * Airtable in P21). Poll-only: `subscribe` is intentionally omitted so the
 * sync engine drives it via the per-connector cron entry.
 *
 * `fetchAll` reads the configured CSV under `CAIRN_CONNECTOR_CSV_PATH`/
 * `<relativePath>`, parses it with the configured delimiter + encoding, and
 * projects each row's columns onto Cairn property ids via `columnMap`.
 *
 * `applyChanges` reads the current file, applies the diff in memory keyed by
 * the external-id column, and rewrites the file with `csv-stringify`. Files
 * are small enough that whole-file rewrite is the simplest correct path; no
 * partial-rewrite logic is shipped in v0.7.0.
 *
 * Path-traversal guard: `path.resolve(mount, relativePath)` must produce a
 * path whose absolute string starts with the canonical mount root plus `sep`
 * (or equals the mount root exactly). Any `..`-escape rejects with
 * `path escapes mount` before any filesystem I/O.
 */
export type CsvSyncConfig = {
  relativePath: string;
  /** ',' or ';' or '\t' — single character. */
  delimiter: string;
  /** Buffer encoding for read/write — typically 'utf8'. */
  encoding: BufferEncoding;
  /** Cairn property id → CSV column header (case-sensitive). */
  columnMap: Record<string, string>;
  externalIdProperty: string;
};

/**
 * The CSV adapter has no auth — the connection is the configured mount path.
 * The framework still encrypts an empty `auth_config` blob (`{}`) at rest so
 * the column shape stays uniform across adapter kinds.
 */
const CsvAuthConfigSchema = z.object({}).strict();

function getCfg(state: ConnectorState): CsvSyncConfig {
  return state.syncConfig as unknown as CsvSyncConfig;
}

function resolveCsvPath(cfg: CsvSyncConfig): string {
  // Read from process.env directly — `env()` caches on first call (see
  // CLAUDE.md gotcha). The mount path can be reconfigured at runtime when
  // the operator edits docker-compose or runs the dev server with an
  // overridden env, and the adapter must pick that up on the next call.
  const mount = process.env.CAIRN_CONNECTOR_CSV_PATH;
  if (!mount) throw new Error('CSV connector mount not configured');
  const mountAbs = resolve(mount);
  const target = resolve(mountAbs, cfg.relativePath);
  if (target !== mountAbs && !target.startsWith(mountAbs + sep)) {
    throw new Error('path escapes mount');
  }
  return target;
}

export const CsvAdapter: ConnectorAdapter = {
  kind: 'csv',

  authConfigSchema: CsvAuthConfigSchema,

  async fetchAll(state) {
    const cfg = getCfg(state);
    const path = resolveCsvPath(cfg);
    const raw = await readFile(path, { encoding: cfg.encoding });
    const records = parse(raw, {
      delimiter: cfg.delimiter,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    const out: ExternalRow[] = [];
    for (const rec of records) {
      const cells: Record<string, unknown> = {};
      for (const [propId, header] of Object.entries(cfg.columnMap)) {
        cells[propId] = rec[header] ?? null;
      }
      const idCellRaw = cells[cfg.externalIdProperty];
      const externalId = idCellRaw == null ? '' : String(idCellRaw);
      if (!externalId) continue; // skip rows with no external id
      out.push({ externalId, cells });
    }
    return out;
  },

  async applyChanges(state, diff: Diff) {
    const cfg = getCfg(state);
    const path = resolveCsvPath(cfg);

    const raw = await readFile(path, { encoding: cfg.encoding }).catch(() => '');
    const records = raw
      ? (parse(raw, {
          delimiter: cfg.delimiter,
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as Array<Record<string, string>>)
      : [];

    const idHeader = cfg.columnMap[cfg.externalIdProperty];
    if (!idHeader) throw new Error('externalIdProperty missing from columnMap');

    const byId = new Map<string, Record<string, string>>();
    for (const rec of records) {
      const id = String(rec[idHeader] ?? '');
      if (id) byId.set(id, rec);
    }

    const acks: AckedChange[] = [];

    // Deletes — drop matching rows.
    for (const d of diff.deletes) {
      byId.delete(d.externalId);
      acks.push({ kind: 'delete', externalId: d.externalId });
    }

    // Updates — overlay mapped cells onto the existing row.
    for (const u of diff.updates) {
      const existing = byId.get(u.externalId) ?? {};
      for (const [propId, header] of Object.entries(cfg.columnMap)) {
        if (propId in u.cells) existing[header] = String(u.cells[propId] ?? '');
      }
      existing[idHeader] = u.externalId;
      byId.set(u.externalId, existing);
      acks.push({ kind: 'update', externalId: u.externalId });
    }

    // Creates — append a fresh row. The CSV has no concept of server-side id
    // assignment, so we lift the external-id property value from the create
    // payload itself. If the payload's id cell is empty we synthesize one
    // from the cairnRowId so the round-trip stays consistent.
    for (const c of diff.creates) {
      const row: Record<string, string> = {};
      for (const [propId, header] of Object.entries(cfg.columnMap)) {
        if (propId in c.cells) row[header] = String(c.cells[propId] ?? '');
      }
      const idCandidate = row[idHeader] ?? '';
      const externalId = idCandidate || c.cairnRowId;
      row[idHeader] = externalId;
      byId.set(externalId, row);
      acks.push({ kind: 'create', cairnRowId: c.cairnRowId, externalId });
    }

    const headers = Object.values(cfg.columnMap);
    const out = stringify(Array.from(byId.values()), {
      header: true,
      columns: headers,
      delimiter: cfg.delimiter,
    });
    await writeFile(path, out, { encoding: cfg.encoding });

    return { acks };
  },

  // subscribe intentionally omitted — poll-only.
};
