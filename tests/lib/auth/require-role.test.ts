import { describe, expect, it } from 'vitest';
import { hasMinRole, type MemberRole } from '@/lib/auth/require-role';

describe('hasMinRole', () => {
  const cases: [MemberRole, MemberRole, boolean][] = [
    ['owner', 'owner', true],
    ['admin', 'owner', false],
    ['admin', 'admin', true],
    ['editor', 'admin', false],
    ['editor', 'editor', true],
    ['viewer', 'editor', false],
    ['viewer', 'viewer', true],
    ['owner', 'viewer', true],
  ];
  for (const [actual, required, expected] of cases) {
    it(`${actual} has min ${required}? -> ${expected}`, () => {
      expect(hasMinRole(actual, required)).toBe(expected);
    });
  }
});
