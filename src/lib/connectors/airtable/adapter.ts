import { z } from 'zod';
import type {
  AckedChange,
  ConnectorAdapter,
  ConnectorState,
  Diff,
  ExternalRow,
} from '@/lib/connectors/adapter';

const AIRTABLE_API = 'https://api.airtable.com/v0';
/**
 * Airtable's hard cap on records-per-request for create/update/delete operations.
 * The adapter must chunk strictly under this — confirmed in adapter.test.ts.
 * See: https://airtable.com/developers/web/api/create-records
 */
const BATCH_LIMIT = 10;

/**
 * Plaintext auth_config for the Airtable adapter. Sealed by the framework's
 * envelope encryption (`src/lib/connectors/auth.ts`) before storage, so both
 * fields are encrypted-at-rest as required by spec §5.1.
 *
 * - `pat`: the user-pasted Airtable Personal Access Token. Sent on every API
 *   call as `Authorization: Bearer <pat>`.
 * - `webhookMacSecret`: the base64-encoded per-webhook MAC secret that Airtable
 *   returns from `POST /v0/bases/{baseId}/webhooks`. Used by the webhook
 *   receiver to validate `X-Airtable-Content-MAC` against the raw request body.
 *   Populated by `subscribe`; absent until the first subscribe call.
 */
export type AirtableAuthConfig = {
  pat: string;
  webhookMacSecret?: string;
};

/**
 * Airtable adapter `sync_config` shape (stored in `database_connectors.sync_config`).
 *
 * - `baseId`: Airtable base id (`appXXXXXXXX`).
 * - `tableId`: Airtable table id (`tblXXXXXXXX`) or table name.
 * - `fieldMap`: Cairn property id → Airtable field name (case-sensitive).
 * - `externalIdProperty`: which Cairn property holds the stable cross-system id.
 * - `airtableWebhook`: webhook registration state (set by `subscribe`).
 */
export type AirtableSyncConfig = {
  baseId: string;
  tableId: string;
  fieldMap: Record<string, string>;
  externalIdProperty: string;
  airtableWebhook?: {
    id: string;
    macSecretBase64: string;
  } | null;
};

const AirtableAuthConfigSchema = z.object({
  pat: z.string().min(1),
  webhookMacSecret: z.string().optional(),
});

function getCfg(state: ConnectorState): AirtableSyncConfig {
  return state.syncConfig as unknown as AirtableSyncConfig;
}

function getPat(state: ConnectorState): string {
  return (state.authConfig as unknown as AirtableAuthConfig).pat;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function recordToCells(
  rec: { id: string; fields: Record<string, unknown> },
  cfg: AirtableSyncConfig,
): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const [propId, fieldName] of Object.entries(cfg.fieldMap)) {
    cells[propId] = rec.fields[fieldName] ?? null;
  }
  return cells;
}

function cellsToFields(
  cells: Record<string, unknown>,
  cfg: AirtableSyncConfig,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [propId, fieldName] of Object.entries(cfg.fieldMap)) {
    if (propId in cells) fields[fieldName] = cells[propId];
  }
  return fields;
}

/**
 * Airtable adapter — second concrete `ConnectorAdapter` (after Sheets in P20).
 *
 * - `fetchAll` paginates the Records API (`GET /v0/{baseId}/{tableId}`) by
 *   following `offset` until exhausted. Maps each record's `fields` onto Cairn
 *   property ids using `syncConfig.fieldMap`.
 * - `applyChanges` chunks creates/updates/deletes into ≤10-record batches
 *   (Airtable's hard limit), POSTs/PATCHes/DELETEs them, and returns one ack
 *   per applied change.
 * - `subscribe` registers a Cairn-targeted webhook with Airtable for the
 *   configured base+table; persists the returned MAC secret on `authConfig`
 *   and the webhook id on `syncConfig.airtableWebhook` so the receiver can
 *   validate HMAC and the operator can revoke later.
 */
export const AirtableAdapter: ConnectorAdapter = {
  kind: 'airtable',

  authConfigSchema: AirtableAuthConfigSchema,

  async fetchAll(state) {
    const cfg = getCfg(state);
    const token = getPat(state);
    const headers = { Authorization: `Bearer ${token}` };
    const base = `${AIRTABLE_API}/${encodeURIComponent(cfg.baseId)}/${encodeURIComponent(cfg.tableId)}`;
    const out: ExternalRow[] = [];
    let offset: string | undefined;
    do {
      const url = offset
        ? `${base}?pageSize=100&offset=${encodeURIComponent(offset)}`
        : `${base}?pageSize=100`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`airtable.list ${res.status}`);
      const body = (await res.json()) as {
        records: Array<{ id: string; fields: Record<string, unknown> }>;
        offset?: string;
      };
      for (const r of body.records) {
        out.push({ externalId: r.id, cells: recordToCells(r, cfg) });
      }
      offset = body.offset;
    } while (offset);
    return out;
  },

  async applyChanges(state, diff: Diff) {
    const cfg = getCfg(state);
    const token = getPat(state);
    const jsonHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const tableUrl = `${AIRTABLE_API}/${encodeURIComponent(cfg.baseId)}/${encodeURIComponent(cfg.tableId)}`;
    const acks: AckedChange[] = [];

    // Creates → batched POST. Airtable assigns the record id; we return it on the ack
    // so the sync engine can populate connector_row_map.externalId for fresh rows.
    for (const group of chunk(diff.creates, BATCH_LIMIT)) {
      const body = {
        records: group.map((c) => ({ fields: cellsToFields(c.cells, cfg) })),
      };
      const res = await fetch(tableUrl, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`airtable.post ${res.status}`);
      const resBody = (await res.json()) as {
        records: Array<{ id: string; fields: Record<string, unknown> }>;
      };
      group.forEach((c, i) => {
        const assigned = resBody.records[i]?.id;
        if (!assigned) throw new Error('airtable.post: missing record id in response');
        acks.push({ kind: 'create', cairnRowId: c.cairnRowId, externalId: assigned });
      });
    }

    // Updates → batched PATCH. The records include `id` so Airtable updates
    // existing rows by record id (no upsert dance needed — we already have ids).
    for (const group of chunk(diff.updates, BATCH_LIMIT)) {
      const body = {
        records: group.map((u) => ({
          id: u.externalId,
          fields: cellsToFields(u.cells, cfg),
        })),
      };
      const res = await fetch(tableUrl, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`airtable.patch ${res.status}`);
      for (const u of group) acks.push({ kind: 'update', externalId: u.externalId });
    }

    // Deletes → batched DELETE via repeated `records[]=id` query params.
    for (const group of chunk(diff.deletes, BATCH_LIMIT)) {
      const qs = group.map((d) => `records[]=${encodeURIComponent(d.externalId)}`).join('&');
      const res = await fetch(`${tableUrl}?${qs}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`airtable.delete ${res.status}`);
      for (const d of group) acks.push({ kind: 'delete', externalId: d.externalId });
    }

    return { acks };
  },

  async subscribe(state, _onChange) {
    const cfg = getCfg(state);
    const token = getPat(state);
    const webhookUrl = `${process.env.PUBLIC_URL ?? ''}/api/connectors/airtable/webhook?w=${encodeURIComponent(state.workspaceId ?? '')}&c=${encodeURIComponent(state.connectorId)}`;

    const res = await fetch(`${AIRTABLE_API}/bases/${encodeURIComponent(cfg.baseId)}/webhooks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationUrl: webhookUrl,
        specification: {
          options: {
            filters: { dataTypes: ['tableData'], recordChangeScope: cfg.tableId },
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`airtable.webhook.register ${res.status}`);
    const body = (await res.json()) as { id: string; macSecretBase64: string };

    // Mirror P20: mutate state in-memory; the caller persists state.syncConfig
    // and state.authConfig back to the connector row.
    (state.syncConfig as Record<string, unknown>).airtableWebhook = {
      id: body.id,
      macSecretBase64: body.macSecretBase64,
    };
    (state.authConfig as Record<string, unknown>).webhookMacSecret = body.macSecretBase64;

    return async () => {
      try {
        await fetch(
          `${AIRTABLE_API}/bases/${encodeURIComponent(cfg.baseId)}/webhooks/${encodeURIComponent(body.id)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      } catch {
        // Webhook may already be expired/revoked — ignore.
      }
    };
  },
};
