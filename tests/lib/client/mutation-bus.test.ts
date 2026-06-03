import { afterEach, expect, it, vi } from 'vitest';
import { emitMutation, subscribeMutation } from '@/lib/client/mutation-bus';

afterEach(() => vi.restoreAllMocks());

it('delivers emit to a subscriber for the same topic', () => {
  const cb = vi.fn();
  const off = subscribeMutation('savedSearches', cb);
  emitMutation('savedSearches');
  expect(cb).toHaveBeenCalledTimes(1);
  off();
  emitMutation('savedSearches');
  expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
});

it('does not cross topics', () => {
  const cb = vi.fn();
  const off = subscribeMutation('pageVersions', cb);
  emitMutation('savedSearches');
  expect(cb).not.toHaveBeenCalled();
  off();
});
