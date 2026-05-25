import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetQuickCaptureForTests,
  openQuickCapture,
  subscribeQuickCapture,
} from '@/components/quick-capture/controller';

afterEach(() => {
  __resetQuickCaptureForTests();
});

describe('quick-capture controller', () => {
  it('invokes subscribed listeners when openQuickCapture is called', () => {
    const listener = vi.fn();
    subscribeQuickCapture(listener);
    openQuickCapture();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe handle that detaches the listener', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeQuickCapture(listener);
    unsubscribe();
    openQuickCapture();
    expect(listener).not.toHaveBeenCalled();
  });

  it('fans out to multiple listeners', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeQuickCapture(a);
    subscribeQuickCapture(b);
    openQuickCapture();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
