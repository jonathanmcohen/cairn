import type { ZodSchema } from 'zod';
import type * as schema from '@/db/schema';

/**
 * One external row as the adapter sees it. The adapter is responsible for
 * mapping its native columns/fields onto Cairn property ids in `cells` — the
 * sync engine never touches the adapter's external schema.
 */
export type ExternalRow = {
  externalId: string;
  /** Per-Cairn-property values. Keys are Cairn `db_properties.id`. */
  cells: Record<string, unknown>;
  /** Adapter-supplied last-modified timestamp for LWW (best-effort; null acceptable). */
  modifiedAt?: Date | null;
};

/**
 * A diff the sync engine asks the adapter to push to the external system.
 * `creates` carry no `externalId` yet — the adapter returns the assigned id
 * via `ack`. `updates` carry the existing `externalId` from `connector_row_map`.
 */
export type Diff = {
  creates: Array<{ cairnRowId: string; cells: Record<string, unknown> }>;
  updates: Array<{ externalId: string; cells: Record<string, unknown> }>;
  deletes: Array<{ externalId: string }>;
};

/**
 * Adapter `applyChanges` returns one ack per applied change so the sync engine
 * can map cairn-row-id ↔ external-id (especially for fresh creates).
 */
export type AckedChange =
  | { kind: 'create'; cairnRowId: string; externalId: string }
  | { kind: 'update'; externalId: string }
  | { kind: 'delete'; externalId: string };

/**
 * Per-connector runtime state passed into every adapter call: the decrypted
 * auth + the sync_config jsonb (mapping, sheet id, poll interval, …).
 */
export type ConnectorState = {
  connectorId: string;
  /** Set by the sync engine so push subscriptions can sign per-workspace tokens. */
  workspaceId?: string;
  authConfig: Record<string, unknown>;
  syncConfig: Record<string, unknown>;
};

export interface ConnectorAdapter {
  kind: schema.ConnectorKind;
  /** Zod schema for the *plaintext* auth_config; the framework encrypts at write. */
  authConfigSchema: ZodSchema;
  fetchAll(state: ConnectorState): Promise<ExternalRow[]>;
  applyChanges(state: ConnectorState, diff: Diff): Promise<{ acks: AckedChange[] }>;
  /** Optional push: subscribe to the external service's change notifications. */
  subscribe?(state: ConnectorState, onChange: () => void): Promise<() => void>;
}
