export type ShortcutScope = 'global' | 'editor';
export type ShortcutKind = 'action' | 'command';

export type ShortcutEntry = {
  id: string;
  keys: string;
  scope: ShortcutScope;
  kind: ShortcutKind;
  labelKey: string;
  run: () => void;
};

export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const MODIFIER_ORDER = ['mod', 'alt', 'shift'] as const;
const MODIFIERS = new Set<string>(MODIFIER_ORDER);

export function normalizeKeys(keys: string): string {
  const parts = keys
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const mods: string[] = [];
  const others: string[] = [];
  for (const part of parts) {
    if (MODIFIERS.has(part)) mods.push(part);
    else others.push(part);
  }
  const sortedMods = MODIFIER_ORDER.filter((m) => mods.includes(m));
  return [...sortedMods, ...others].join('+');
}

const registry: ShortcutEntry[] = [];

export function registerShortcut(entry: ShortcutEntry): void {
  const normalized = normalizeKeys(entry.keys);
  const existingIdx = registry.findIndex((r) => r.id === entry.id);
  if (existingIdx !== -1) {
    // Re-register by id: replace, no throw.
    registry[existingIdx] = entry;
    return;
  }
  const collision = registry.find(
    (r) => r.scope === entry.scope && normalizeKeys(r.keys) === normalized,
  );
  if (collision) {
    throw new Error(
      `Shortcut conflict: ${entry.id} (${entry.keys}) collides with ${collision.id} (${collision.keys}) in scope ${entry.scope}`,
    );
  }
  registry.push(entry);
}

export function getShortcuts(scope?: ShortcutScope): ShortcutEntry[] {
  if (!scope) return [...registry];
  return registry.filter((r) => r.scope === scope);
}

export function matchShortcut(e: KeyEventLike, scope: ShortcutScope): ShortcutEntry | null {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key.toLowerCase());
  const eventKeys = parts.join('+');
  for (const entry of registry) {
    if (entry.scope !== scope) continue;
    if (normalizeKeys(entry.keys) === eventKeys) return entry;
  }
  return null;
}

export function resetRegistry(): void {
  registry.length = 0;
}
