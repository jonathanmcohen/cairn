// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { canFederate } from '@/app/(app)/search/can-federate';

describe('search page gating (#164)', () => {
  it('admins and owners can federate; others cannot', () => {
    expect(canFederate('owner')).toBe(true);
    expect(canFederate('admin')).toBe(true);
    expect(canFederate('editor')).toBe(false);
    expect(canFederate('viewer')).toBe(false);
    expect(canFederate(null)).toBe(false);
  });

  it('settings sidebar source lists a Search section', async () => {
    const [{ readFileSync }, { resolve }] = await Promise.all([
      import('node:fs'),
      import('node:path'),
    ]);
    const src = readFileSync(resolve(process.cwd(), 'src/components/settings/sidebar.tsx'), 'utf8');
    expect(src).toContain("href: '/search' as Route");
  });
});
