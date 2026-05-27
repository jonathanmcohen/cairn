import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@/lib/audit/actions';

describe('AUDIT_ACTIONS — v0.9.0 G4 P26 page lifecycle additions', () => {
  it('includes page.status_changed', () => {
    expect(AUDIT_ACTIONS).toContain('page.status_changed');
  });
  it('includes page.translation_linked', () => {
    expect(AUDIT_ACTIONS).toContain('page.translation_linked');
  });
});
