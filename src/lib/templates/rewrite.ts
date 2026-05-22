import { randomUUID } from 'node:crypto';
import type { TemplatePayload } from './payload';

export type IdRemap = Map<string, string>;

/** Mint a fresh uuid for every entity id captured in the payload. */
export function buildRemap(payload: TemplatePayload): IdRemap {
  const remap: IdRemap = new Map();
  const add = (id: string | null | undefined) => {
    if (id && !remap.has(id)) remap.set(id, randomUUID());
  };
  for (const page of payload.pages) add(page.id);
  for (const db of payload.databases) {
    add(db.id);
    for (const prop of db.properties) add(prop.id);
    for (const view of db.views) add(view.id);
    for (const row of db.rows) add(row.id);
  }
  return remap;
}

/** Remap an id if it is captured here; otherwise leave it (external ref). */
function remapId(id: string | null, remap: IdRemap): string | null {
  if (id === null) return null;
  return remap.get(id) ?? id;
}

/**
 * Config keys that hold an internal id reference. View configs reference
 * property ids; relation/rollup property configs reference a database id and/or
 * a property id. We rewrite *only* values found under these keys and only when
 * the value is present in the remap — so unrelated config (select option ids,
 * number format, filter operators/values) is never touched.
 */
const ID_FIELDS = new Set([
  'propertyId',
  'databaseId',
  'relationDatabaseId',
  'relationPropertyId',
  'rollupPropertyId',
  'groupBy',
]);
const ID_ARRAY_FIELDS = new Set(['visibleProperties']);

/** Deep-clone a config blob, rewriting any id-bearing field via the remap. */
function rewriteConfig(value: unknown, remap: IdRemap): unknown {
  if (Array.isArray(value)) return value.map((v) => rewriteConfig(v, remap));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ID_FIELDS.has(k) && typeof v === 'string') {
        out[k] = remap.get(v) ?? v;
      } else if (ID_FIELDS.has(k) && v === null) {
        out[k] = null;
      } else if (ID_ARRAY_FIELDS.has(k) && Array.isArray(v)) {
        out[k] = v.map((item) => (typeof item === 'string' ? (remap.get(item) ?? item) : item));
      } else {
        out[k] = rewriteConfig(v, remap);
      }
    }
    return out;
  }
  return value;
}

/** Deep-clone page content, rewriting every `database` node's databaseId. */
function rewriteContent(node: unknown, remap: IdRemap): unknown {
  if (Array.isArray(node)) return node.map((n) => rewriteContent(n, remap));
  if (node && typeof node === 'object') {
    const n = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'attrs' && v && typeof v === 'object') {
        const attrs = v as Record<string, unknown>;
        const nextAttrs: Record<string, unknown> = { ...attrs };
        if (n.type === 'database' && typeof attrs.databaseId === 'string') {
          nextAttrs.databaseId = remap.get(attrs.databaseId) ?? attrs.databaseId;
        }
        out[k] = nextAttrs;
      } else if (k === 'content') {
        out[k] = rewriteContent(v, remap);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return node;
}

/**
 * Return a NEW payload with every internal id reference remapped. Pure: the
 * input is not mutated. References to ids absent from `remap` (entities outside
 * this payload) are left untouched.
 */
export function rewriteRefs(payload: TemplatePayload, remap: IdRemap): TemplatePayload {
  return {
    kind: payload.kind,
    rootPageId: payload.rootPageId
      ? (remap.get(payload.rootPageId) ?? payload.rootPageId)
      : undefined,
    rootDatabaseId: payload.rootDatabaseId
      ? (remap.get(payload.rootDatabaseId) ?? payload.rootDatabaseId)
      : undefined,
    pages: payload.pages.map((p) => ({
      id: remap.get(p.id) ?? p.id,
      parentId: remapId(p.parentId, remap),
      title: p.title,
      icon: p.icon,
      content: rewriteContent(p.content, remap),
    })),
    databases: payload.databases.map((d) => ({
      id: remap.get(d.id) ?? d.id,
      name: d.name,
      properties: d.properties.map((pr) => ({
        id: remap.get(pr.id) ?? pr.id,
        name: pr.name,
        type: pr.type,
        config: rewriteConfig(pr.config, remap),
        position: pr.position,
      })),
      views: d.views.map((v) => ({
        id: remap.get(v.id) ?? v.id,
        type: v.type,
        name: v.name,
        config: rewriteConfig(v.config, remap),
        position: v.position,
      })),
      rows: d.rows.map((r) => ({
        id: remap.get(r.id) ?? r.id,
        cells: r.cells.map((c) => ({
          propertyId: remap.get(c.propertyId) ?? c.propertyId,
          value: c.value,
        })),
      })),
    })),
  };
}
