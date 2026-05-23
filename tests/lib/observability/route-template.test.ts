import { describe, expect, it } from 'vitest';
import { routeTemplate } from '@/lib/observability/route-template';

describe('routeTemplate', () => {
  it('collapses UUIDs to :id', () => {
    expect(routeTemplate('/api/v1/pages/3f8b9c2a-1111-4222-8333-444455556666')).toBe(
      '/api/v1/pages/:id',
    );
    expect(
      routeTemplate(
        '/api/v1/databases/3f8b9c2a-1111-4222-8333-444455556666/rows/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ),
    ).toBe('/api/v1/databases/:id/rows/:id');
  });

  it('collapses long hex / numeric / slug segments to :id', () => {
    expect(routeTemplate('/api/files/0123456789abcdef0123456789abcdef')).toBe('/api/files/:id');
    expect(routeTemplate('/p/some-published-slug-12345')).toBe('/p/:id');
    expect(routeTemplate('/api/v1/pages/12345')).toBe('/api/v1/pages/:id');
  });

  it('preserves stable, low-cardinality literal paths', () => {
    expect(routeTemplate('/api/health')).toBe('/api/health');
    expect(routeTemplate('/metrics')).toBe('/metrics');
    expect(routeTemplate('/api/v1/pages')).toBe('/api/v1/pages');
  });

  it('strips the query string and trailing slash', () => {
    expect(routeTemplate('/api/v1/pages?limit=25&cursor=abc')).toBe('/api/v1/pages');
    expect(routeTemplate('/api/v1/pages/')).toBe('/api/v1/pages');
  });

  it('caps the set of distinct templates (cardinality guard)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(routeTemplate(`/api/v1/pages/${crypto.randomUUID()}`));
    }
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBe('/api/v1/pages/:id');
  });
});
