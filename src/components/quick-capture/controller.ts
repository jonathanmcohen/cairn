/**
 * Module-level open/close pub-sub for the quick-capture modal. Lets the
 * v0.6 P15 shortcut registry's `run: () => void` callback fire
 * `openQuickCapture()` without needing a React context handle — the modal
 * subscribes on mount and toggles its own open-state on every emit.
 *
 * Single-tab scope; not cross-tab. No persistence.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeQuickCapture(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openQuickCapture(): void {
  for (const fn of listeners) fn();
}

/** Test-only — clears all subscriptions. */
export function __resetQuickCaptureForTests(): void {
  listeners.clear();
}
