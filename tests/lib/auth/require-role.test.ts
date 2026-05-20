import { type MemberRole, hasMinRole } from '@/lib/auth/require-role';
import { describe, expect, it } from 'vitest';

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
