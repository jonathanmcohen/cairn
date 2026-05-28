import { describe, expect, it } from 'vitest';
import { parseSlashCommand } from '@/lib/chat/slash';

describe('parseSlashCommand', () => {
  it('parses search command', () => {
    const cmd = parseSlashCommand('search hello world');
    expect(cmd).toEqual({ kind: 'search', query: 'hello world' });
  });

  it('parses create-page command', () => {
    const cmd = parseSlashCommand('create page Project kickoff notes');
    expect(cmd).toEqual({ kind: 'create_page', title: 'Project kickoff notes' });
  });

  it('rejects empty search', () => {
    expect(parseSlashCommand('search')).toEqual({
      kind: 'error',
      message: expect.any(String),
    });
  });

  it('rejects empty page title', () => {
    expect(parseSlashCommand('create page')).toEqual({
      kind: 'error',
      message: expect.any(String),
    });
  });

  it('rejects unknown subcommand', () => {
    expect(parseSlashCommand('foo bar')).toEqual({
      kind: 'error',
      message: expect.any(String),
    });
  });

  it('trims leading/trailing whitespace + collapses inner runs', () => {
    expect(parseSlashCommand('  search   hello  ')).toEqual({
      kind: 'search',
      query: 'hello',
    });
  });

  it('caps title at 255 chars', () => {
    const long = 'a'.repeat(300);
    const result = parseSlashCommand(`create page ${long}`);
    expect(result.kind).toBe('create_page');
    if (result.kind === 'create_page') expect(result.title.length).toBe(255);
  });

  it('caps query at 200 chars', () => {
    const long = 'q'.repeat(400);
    const result = parseSlashCommand(`search ${long}`);
    expect(result.kind).toBe('search');
    if (result.kind === 'search') expect(result.query.length).toBe(200);
  });
});
