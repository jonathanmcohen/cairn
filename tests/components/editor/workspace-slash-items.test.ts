// @vitest-environment jsdom
//
// v0.10.0 F2 — pure-testable halves of the workspace slash-command menu
// integration:
//  1. workspaceSlashItem(): the SlashItem adapter (Workspace category, sync
//     insert-through-the-pipeline command, trigger as search alias);
//  2. the cache module (enabled/insertable filtering, per-workspace keying);
//  3. grouping: workspace items land in their own trailing group;
//  4. the BUILTIN_SLASH_TRIGGERS duplicate is pinned to the live registry
//     (the server lib can't import slash-extension — tippy/React — so the
//     list is duplicated and THIS test keeps it honest).
import { describe, expect, it } from 'vitest';
import {
  citationLookupMenuItem,
  citationMenuItem,
  datetimeMenuItem,
  footnoteMenuItem,
  matchesSlashQuery,
  SLASH_ITEMS,
  workspaceSlashItem,
} from '@/components/editor/slash-extension';
import { groupSlashItems, SLASH_CATEGORY_ORDER } from '@/components/editor/slash-menu';
import {
  clearWorkspaceSlashCommandsCache,
  getWorkspaceSlashCommands,
  insertableWorkspaceSlashCommands,
  setWorkspaceSlashCommandsCache,
  type WorkspaceSlashCommandItem,
} from '@/components/editor/slash-workspace-commands';
import {
  BUILTIN_SLASH_TRIGGERS,
  isBuiltinSlashTrigger,
  slugifySlashWord,
} from '@/lib/slash-commands/builtin-triggers';

const PARA = { type: 'paragraph', content: [{ type: 'text', text: 'Tpl body' }] };

function cmd(over: Partial<WorkspaceSlashCommandItem> = {}): WorkspaceSlashCommandItem {
  return {
    id: 'c1',
    trigger: 'meeting',
    label: 'Meeting notes',
    templateId: 't1',
    templateName: 'Meeting notes tpl',
    enabled: true,
    content: [PARA],
    ...over,
  };
}

describe('workspaceSlashItem', () => {
  it('maps a command into a Workspace-group SlashItem searchable by trigger', () => {
    const item = workspaceSlashItem(cmd());
    expect(item.category).toBe('workspace');
    expect(item.title).toBe('Meeting notes');
    expect(item.description).toContain('/meeting');
    expect(item.keywords).toContain('meeting');
    // SYNCHRONOUS insert: the dispatcher consumes the /trigger range itself.
    expect(item.deferred).toBeUndefined();
    // Searchable through the shared predicate by trigger AND by label.
    expect(matchesSlashQuery(item, 'meeting')).toBe(true);
    expect(matchesSlashQuery(item, 'notes')).toBe(true);
    expect(matchesSlashQuery(item, 'zzz-nope')).toBe(false);
  });
});

describe('workspace slash-commands cache', () => {
  it('filters disabled rows and rows without insertable content', () => {
    const rows = [
      cmd({ id: 'a' }),
      cmd({ id: 'b', enabled: false }),
      cmd({ id: 'c', content: null }),
      cmd({ id: 'd', content: [] }),
    ];
    expect(insertableWorkspaceSlashCommands(rows).map((r) => r.id)).toEqual(['a']);

    setWorkspaceSlashCommandsCache('ws-1', rows);
    expect(getWorkspaceSlashCommands('ws-1').map((r) => r.id)).toEqual(['a']);
    clearWorkspaceSlashCommandsCache();
  });

  it('is keyed by workspace and empty for unknown/undefined ids', () => {
    setWorkspaceSlashCommandsCache('ws-1', [cmd()]);
    expect(getWorkspaceSlashCommands('ws-1')).toHaveLength(1);
    expect(getWorkspaceSlashCommands('ws-2')).toEqual([]);
    expect(getWorkspaceSlashCommands(undefined)).toEqual([]);
    clearWorkspaceSlashCommandsCache();
  });
});

describe('grouping', () => {
  it("workspace commands group under the trailing 'workspace' category", () => {
    expect(SLASH_CATEGORY_ORDER[SLASH_CATEGORY_ORDER.length - 1]).toBe('workspace');
    const merged = [...SLASH_ITEMS, workspaceSlashItem(cmd())];
    const groups = groupSlashItems(merged);
    const last = groups[groups.length - 1];
    expect(last?.category).toBe('workspace');
    expect(last?.items.map((i) => i.title)).toEqual(['Meeting notes']);
    // Built-in groups are untouched by the merge.
    expect(groups.map((g) => g.category).slice(0, -1)).toEqual([
      'basic',
      'media',
      'database',
      'advanced',
    ]);
  });
});

describe('BUILTIN_SLASH_TRIGGERS pinning', () => {
  it('covers every format-valid title/keyword/command of the live registry', () => {
    const derived = new Set<string>();
    for (const item of SLASH_ITEMS) {
      derived.add(slugifySlashWord(item.title));
      for (const k of item.keywords) derived.add(slugifySlashWord(k));
    }
    for (const entry of [
      footnoteMenuItem,
      citationMenuItem,
      citationLookupMenuItem,
      datetimeMenuItem,
    ]) {
      derived.add(entry.command.slice(1));
    }
    const VALID = /^[a-z0-9-]{2,32}$/;
    const missing = [...derived].filter((w) => VALID.test(w) && !isBuiltinSlashTrigger(w));
    expect(missing, `add these to BUILTIN_SLASH_TRIGGERS: ${missing.join(', ')}`).toEqual([]);
  });

  it('spot-checks the e2e collision trigger and rejects non-builtins', () => {
    expect(isBuiltinSlashTrigger('todo')).toBe(true);
    expect(isBuiltinSlashTrigger('table')).toBe(true);
    expect(isBuiltinSlashTrigger('cite-doi')).toBe(true);
    expect(isBuiltinSlashTrigger('my-own-command')).toBe(false);
    // The exported list and the membership check agree.
    for (const t of BUILTIN_SLASH_TRIGGERS) expect(isBuiltinSlashTrigger(t)).toBe(true);
  });
});
