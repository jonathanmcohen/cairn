import { describe, expect, it } from 'vitest';
import { expandTemplates } from '@/lib/search/operators-template';

describe('expandTemplates', () => {
  const templates = [
    { name: 'bugs', expansion: 'tag:bug type:page status:open' },
    { name: 'mine', expansion: 'from:me' },
    { name: 'nested', expansion: 'tag:foo @bugs' },
  ];

  it('returns input unchanged when no @ token', () => {
    expect(expandTemplates('release notes from:alice', templates).text).toBe(
      'release notes from:alice',
    );
  });

  it('expands a known template inline', () => {
    expect(expandTemplates('@bugs ladder', templates).text).toBe(
      'tag:bug type:page status:open ladder',
    );
  });

  it('expands multiple templates in order', () => {
    expect(expandTemplates('@bugs @mine', templates).text).toBe(
      'tag:bug type:page status:open from:me',
    );
  });

  it('leaves unknown templates as a warning + raw token', () => {
    const r = expandTemplates('@unknown @bugs', templates);
    expect(r.text).toBe('@unknown tag:bug type:page status:open');
    expect(r.warnings).toEqual([{ kind: 'unknown_template', name: 'unknown' }]);
  });

  it('refuses to expand a template whose expansion contains @', () => {
    const r = expandTemplates('@nested', templates);
    expect(r.text).toBe('@nested');
    expect(r.warnings).toEqual([{ kind: 'nested_template', name: 'nested' }]);
  });

  it('ignores @ inside quoted values', () => {
    expect(expandTemplates('tag:"@bugs is a label"', templates).text).toBe(
      'tag:"@bugs is a label"',
    );
  });
});
