import { describe, expect, it } from 'vitest';
import { extractMentions } from '@/lib/mentions/parse';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('extractMentions', () => {
  it('returns [] when there are no mentions', () => {
    expect(extractMentions('just some text, nothing @ here really')).toEqual([]);
    expect(extractMentions('')).toEqual([]);
  });

  it('extracts a single mention userId', () => {
    expect(extractMentions(`hey @[Ada Lovelace](${A}) look`)).toEqual([A]);
  });

  it('extracts many and dedupes (first-seen order)', () => {
    const body = `@[Ada](${A}) and @[Bob](${B}) and again @[Ada Again](${A})`;
    expect(extractMentions(body)).toEqual([A, B]);
  });

  it('ignores malformed tokens (no parens, empty id, plain @name)', () => {
    expect(extractMentions('@[NoId] @plainname @[X]() @[Y]( )')).toEqual([]);
  });
});
