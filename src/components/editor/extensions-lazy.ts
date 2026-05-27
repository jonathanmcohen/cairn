import type { AnyExtension } from '@tiptap/core';

/**
 * Lazy-loaded editor extensions: the schema-only *-node.ts variants live in
 * the static `baseExtensions()` list so existing documents parse correctly,
 * but the heavy React node-views + CSS (KaTeX) + iframe wiring live behind
 * dynamic imports so they're absent from the initial editor bundle.
 *
 * The factory map is consulted from two call sites (editor.tsx):
 *   1. ON MOUNT — walk the initial doc, load any lazy node names found.
 *   2. ON INSERT — slash commands / shortcuts that mint a lazy node load
 *      its factory first, then call the editor command.
 */
export const EDITOR_NODE_NAMES = [
  'math',
  'syncedBlock',
  'embed',
  'mermaid',
  'plantuml',
  'drawio',
  'gallery',
  'pdf',
] as const;
export type LazyEditorNodeName = (typeof EDITOR_NODE_NAMES)[number];

const FACTORIES: Record<LazyEditorNodeName, () => Promise<{ default: AnyExtension }>> = {
  math: () => import('./extensions/math'),
  syncedBlock: () => import('./extensions/synced-block'),
  embed: () => import('./extensions/embed'),
  mermaid: () => import('./extensions/mermaid'),
  plantuml: () => import(/* webpackChunkName: "plantuml" */ './extensions/plantuml'),
  drawio: () => import('./extensions/drawio'),
  gallery: () => import('./extensions/gallery'),
  pdf: () => import(/* webpackChunkName: "pdf" */ './extensions/pdf'),
};

/** Load one lazy extension by its TipTap node name. */
export async function loadEditorExtension(name: LazyEditorNodeName): Promise<AnyExtension> {
  const factory = FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown lazy editor extension: ${String(name)}`);
  }
  const mod = await factory();
  return mod.default;
}

/**
 * Walk a ProseMirror JSON doc and return the SET of lazy node names present.
 * Pure: no DOM, no editor instance.
 */
export function nodeNamesInDoc(doc: unknown): LazyEditorNodeName[] {
  const found = new Set<LazyEditorNodeName>();
  const lazySet = new Set(EDITOR_NODE_NAMES);
  function visit(n: unknown): void {
    if (!n || typeof n !== 'object') return;
    const node = n as { type?: string; content?: unknown[] };
    if (typeof node.type === 'string' && lazySet.has(node.type as LazyEditorNodeName)) {
      found.add(node.type as LazyEditorNodeName);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  }
  visit(doc);
  return Array.from(found);
}
