import { describe, expect, it } from 'vitest';
import { TemplatePayloadSchema } from '@/lib/templates/payload';

describe('TemplatePayload schema', () => {
  it('accepts a minimal page payload', () => {
    const ok = TemplatePayloadSchema.parse({
      kind: 'page',
      rootPageId: 'p1',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'Root',
          icon: null,
          content: { type: 'doc', content: [] },
        },
      ],
      databases: [],
    });
    expect(ok.kind).toBe('page');
  });

  it('accepts a database payload with properties + views', () => {
    const ok = TemplatePayloadSchema.parse({
      kind: 'database',
      rootDatabaseId: 'd1',
      pages: [],
      databases: [
        {
          id: 'd1',
          name: 'Tracker',
          properties: [
            { id: 'pr1', name: 'Status', type: 'select', config: { options: [] }, position: 0 },
          ],
          views: [
            {
              id: 'v1',
              type: 'table',
              name: 'All',
              config: { visibleProperties: ['pr1'] },
              position: 0,
            },
          ],
          rows: [],
        },
      ],
    });
    expect(ok.databases[0]?.properties).toHaveLength(1);
  });

  it('rejects an unknown kind', () => {
    expect(() => TemplatePayloadSchema.parse({ kind: 'wat', pages: [], databases: [] })).toThrow();
  });
});
