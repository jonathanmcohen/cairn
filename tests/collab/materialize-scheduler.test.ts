import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMaterializeScheduler } from '../../collab/materialize-scheduler';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('materialize scheduler', () => {
  it('debounces rapid stores into one flush', () => {
    const flush = vi.fn();
    const s = createMaterializeScheduler({ debounceMs: 1000, flush });
    s.onStore('page-1');
    s.onStore('page-1');
    s.onStore('page-1');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('page-1');
  });

  it('flushes immediately on last disconnect, cancelling the pending debounce', () => {
    const flush = vi.fn();
    const s = createMaterializeScheduler({ debounceMs: 1000, flush });
    s.onStore('page-1');
    s.onLastDisconnect('page-1');
    expect(flush).toHaveBeenCalledTimes(1); // immediate, last edits not lost
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1); // pending timer was cancelled, no double-flush
  });

  it('keeps per-page timers independent', () => {
    const flush = vi.fn();
    const s = createMaterializeScheduler({ debounceMs: 1000, flush });
    s.onStore('a');
    vi.advanceTimersByTime(400);
    s.onStore('b');
    vi.advanceTimersByTime(600); // a fires (1000 total), b at 600
    expect(flush).toHaveBeenCalledWith('a');
    expect(flush).not.toHaveBeenCalledWith('b');
    vi.advanceTimersByTime(400); // b reaches 1000
    expect(flush).toHaveBeenCalledWith('b');
  });
});
