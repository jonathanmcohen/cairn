import { describe, expect, it } from 'vitest';
import type { TemplatePayload } from '@/lib/templates/payload';
import { buildRemap, rewriteRefs } from '@/lib/templates/rewrite';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// biome-ignore lint/suspicious/noExplicitAny: tests drill into z.unknown() content/config blobs
type Any = any;

/** A payload exercising EVERY reference kind the rewriter must handle. */
function fixture(): TemplatePayload {
  return {
    kind: 'page',
    rootPageId: 'Xpage-root',
    pages: [
      {
        id: 'Xpage-root',
        parentId: null,
        title: 'Root',
        icon: null,
        content: { type: 'doc', content: [] },
      },
      {
        id: 'Xpage-child',
        parentId: 'Xpage-root',
        title: 'Child',
        icon: '📄',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
            // database node nested inside another block — deep walk must reach it
            { type: 'callout', content: [{ type: 'database', attrs: { databaseId: 'Xdb-a' } }] },
            { type: 'database', attrs: { databaseId: 'Xdb-b' } },
          ],
        },
      },
    ],
    databases: [
      {
        id: 'Xdb-a',
        name: 'Tasks',
        properties: [
          {
            id: 'Xprop-status',
            name: 'Status',
            type: 'select',
            config: { options: [{ id: 'o1', name: 'Open' }] },
            position: 0,
          },
          // relation property pointing at db-b; rollup pointing at a prop in db-b
          {
            id: 'Xprop-rel',
            name: 'Project',
            type: 'relation',
            config: { targetDatabaseId: 'Xdb-b' },
            position: 1,
          },
          {
            id: 'Xprop-roll',
            name: 'Sum',
            type: 'rollup',
            config: { relationPropertyId: 'Xprop-rel', targetPropertyId: 'Xprop-b-num' },
            position: 2,
          },
          { id: 'Xprop-due', name: 'Due', type: 'date', config: {}, position: 3 },
        ],
        views: [
          {
            id: 'Xview-table',
            type: 'table',
            name: 'All',
            config: {
              visibleProperties: ['Xprop-status', 'Xprop-rel'],
              sorts: [{ propertyId: 'Xprop-status', direction: 'asc' }],
              filters: [{ propertyId: 'Xprop-rel', op: 'is_not_empty', value: null }],
              groupBy: 'Xprop-status',
            },
            position: 0,
          },
          {
            id: 'Xview-cal',
            type: 'calendar',
            name: 'Calendar',
            config: { dateProperty: 'Xprop-due' },
            position: 1,
          },
        ],
        rows: [{ id: 'Xrow-1', cells: [{ propertyId: 'Xprop-status', value: 'o1' }] }],
      },
      {
        id: 'Xdb-b',
        name: 'Projects',
        properties: [
          { id: 'Xprop-b-num', name: 'Budget', type: 'number', config: {}, position: 0 },
        ],
        views: [],
        rows: [],
      },
    ],
  };
}

describe('buildRemap', () => {
  it('mints a fresh uuid for every entity id and is injective', () => {
    const remap = buildRemap(fixture());
    const sources = [
      'Xpage-root',
      'Xpage-child',
      'Xdb-a',
      'Xdb-b',
      'Xprop-status',
      'Xprop-rel',
      'Xprop-roll',
      'Xview-table',
      'Xview-cal',
      'Xrow-1',
      'Xprop-b-num',
      'Xprop-due',
    ];
    for (const s of sources) {
      expect(remap.get(s)).toMatch(UUID);
      expect(remap.get(s)).not.toBe(s);
    }
    const targets = new Set([...remap.values()]);
    expect(targets.size).toBe(sources.length); // injective — no collisions
  });
});

describe('rewriteRefs', () => {
  it('rewrites EVERY internal reference and leaves non-id data intact', () => {
    const payload = fixture();
    const remap = buildRemap(payload);
    const out = rewriteRefs(payload, remap);
    const m = (id: string) => remap.get(id);

    // 1. page ids + parent links
    const root = out.pages.find((p) => p.title === 'Root')!;
    const child = out.pages.find((p) => p.title === 'Child')!;
    expect(root.id).toBe(m('Xpage-root'));
    expect(child.id).toBe(m('Xpage-child'));
    expect(child.parentId).toBe(m('Xpage-root'));
    expect(child.icon).toBe('📄'); // untouched
    expect(out.rootPageId).toBe(m('Xpage-root'));

    // 2. embedded database-node databaseIds (incl. deeply nested)
    const blocks = (child.content as Any).content;
    expect(blocks[1].content[0].attrs.databaseId).toBe(m('Xdb-a')); // inside callout
    expect(blocks[2].attrs.databaseId).toBe(m('Xdb-b'));
    expect(blocks[0].content[0].text).toBe('hi'); // text untouched

    // 3. database ids
    const dbA = out.databases.find((d) => d.name === 'Tasks')!;
    const dbB = out.databases.find((d) => d.name === 'Projects')!;
    expect(dbA.id).toBe(m('Xdb-a'));
    expect(dbB.id).toBe(m('Xdb-b'));

    // 4. property / view / row / cell ids
    const status = dbA.properties.find((p) => p.name === 'Status')!;
    const rel = dbA.properties.find((p) => p.name === 'Project')!;
    const roll = dbA.properties.find((p) => p.name === 'Sum')!;
    expect(status.id).toBe(m('Xprop-status'));
    expect(rel.id).toBe(m('Xprop-rel'));
    expect(dbA.views[0]!.id).toBe(m('Xview-table'));
    expect(dbA.rows[0]!.id).toBe(m('Xrow-1'));
    expect(dbA.rows[0]!.cells[0]!.propertyId).toBe(m('Xprop-status'));
    expect(dbA.rows[0]!.cells[0]!.value).toBe('o1'); // cell value untouched (option id, not an entity id)

    // 5a. relation/rollup config refs
    expect((rel.config as Any).targetDatabaseId).toBe(m('Xdb-b'));
    expect((roll.config as Any).relationPropertyId).toBe(m('Xprop-rel'));
    expect((roll.config as Any).targetPropertyId).toBe(m('Xprop-b-num'));
    // select option ids are NOT entity ids → left alone
    expect((status.config as Any).options[0].id).toBe('o1');

    // 5b. view-config property refs
    const vc = dbA.views[0]!.config as Any;
    expect(vc.visibleProperties).toEqual([m('Xprop-status'), m('Xprop-rel')]);
    expect(vc.sorts[0].propertyId).toBe(m('Xprop-status'));
    expect(vc.filters[0].propertyId).toBe(m('Xprop-rel'));
    expect(vc.groupBy).toBe(m('Xprop-status'));
    // calendar view dateProperty ref
    const cal = dbA.views.find((v) => v.name === 'Calendar')!;
    expect((cal.config as Any).dateProperty).toBe(m('Xprop-due'));

    // NO source id survives anywhere in the output (the dangling-ref guarantee)
    const serialized = JSON.stringify(out);
    for (const src of [
      'Xpage-root',
      'Xpage-child',
      'Xdb-a',
      'Xdb-b',
      'Xprop-status',
      'Xprop-rel',
      'Xprop-roll',
      'Xview-table',
      'Xview-cal',
      'Xrow-1',
      'Xprop-b-num',
      'Xprop-due',
    ]) {
      expect(serialized).not.toContain(src);
    }
  });

  it('leaves references to entities outside the remap untouched', () => {
    const payload = fixture();
    // a relation pointing at a database NOT in this payload (external)
    payload.databases[0]!.properties.push({
      id: 'prop-ext',
      name: 'External',
      type: 'relation',
      config: { targetDatabaseId: 'db-external-not-captured' },
      position: 9,
    });
    const remap = buildRemap(payload);
    const out = rewriteRefs(payload, remap);
    const ext = out.databases[0]!.properties.find((p) => p.name === 'External')!;
    expect((ext.config as Any).targetDatabaseId).toBe('db-external-not-captured'); // unchanged
    expect(ext.id).toBe(remap.get('prop-ext')); // its own id still remapped
  });

  it('is non-mutating — the input payload is unchanged', () => {
    const payload = fixture();
    const before = JSON.stringify(payload);
    rewriteRefs(payload, buildRemap(payload));
    expect(JSON.stringify(payload)).toBe(before);
  });
});
